// Account state reads without transcripts: chat summaries, one record per request, ETag/304 and the
// change feed cursor (`GET /api/me/state?chats=summary&since=<cursor>`), next to the original
// whole-snapshot API that older clients still use.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-account-feed-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
try {
  const server = (await mf.ready).origin;
  const ana = await passwordUser(server, "feed-ana@example.test", "Ana");
  const budi = await passwordUser(server, "feed-budi@example.test", "Budi");
  const get = (session, route, headers = {}) =>
    fetch(server + route, { headers: { "x-verynize-session": session, ...headers } });
  const read = async (session, route) => {
    const response = await get(session, route);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const put = async (session, key, value, revision = 0) => {
    const response = await fetch(server + "/api/me/state/" + encodeURIComponent(key), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-verynize-session": session },
      body: JSON.stringify({ value: value === null ? null : JSON.stringify(value), revision }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).item;
  };
  const SUMMARY = "/api/me/state?chats=summary";

  const transcript = (id, title, count) => ({
    project: "unattached",
    chat: {
      id,
      title,
      created: 1,
      access: "edit",
      messages: Array.from({ length: count }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        text: `Message ${i} ` + "🌴 design notes ".repeat(4000),
      })),
    },
  });
  await put(ana, "preference:theme", "dark");
  await put(ana, "chat:long", transcript("long", "Landing page", 12));
  await put(ana, "chat:gone", transcript("gone", "Deleted later", 1));

  // Older clients: the whole snapshot, transcripts included, internal rows never.
  const full = await read(ana, "/api/me/state");
  const fullBytes = JSON.stringify(full).length;
  assert.deepEqual(
    JSON.parse(full.items.find((item) => item.key === "chat:long").value),
    transcript("long", "Landing page", 12),
  );
  assert.ok(full.items.every((item) => !item.key.startsWith("@")));
  assert.equal(typeof full.cursor, "number");

  // Summary reads: everything but transcripts.
  const summary = await read(ana, SUMMARY);
  const summaryBytes = JSON.stringify(summary).length;
  const long = summary.items.find((item) => item.key === "chat:long");
  assert.equal(long.value, undefined, "transcripts are not part of the summary read");
  assert.deepEqual(JSON.parse(long.summary), {
    project: "unattached",
    chat: { id: "long", title: "Landing page", created: 1, access: "edit", count: 12 },
  });
  assert.equal(summary.items.find((item) => item.key === "preference:theme").value, '"dark"');
  assert.ok(summary.items.every((item) => !item.key.startsWith("@")));
  assert.equal(summary.account.email, "feed-ana@example.test");
  assert.ok(
    summaryBytes * 50 < fullBytes,
    `summary ${summaryBytes} B should be a small fraction of ${fullBytes} B`,
  );

  // One record when a chat opens.
  const opened = await read(ana, "/api/me/state/" + encodeURIComponent("chat:long"));
  assert.deepEqual(JSON.parse(opened.item.value), transcript("long", "Landing page", 12));
  assert.equal(opened.item.revision, long.revision);
  assert.equal((await get(ana, "/api/me/state/chat%3Amissing")).status, 404);
  assert.equal((await get(ana, "/api/me/state/session%3Asecret")).status, 400);
  assert.equal(
    (await get(budi, "/api/me/state/" + encodeURIComponent("chat:long"))).status,
    404,
    "another account cannot read the record",
  );

  // ETag and 304: an unchanged read costs no body.
  const first = await get(ana, SUMMARY);
  const etag = first.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  assert.equal(first.headers.get("access-control-expose-headers"), "ETag");
  const same = await get(ana, SUMMARY, { "if-none-match": etag });
  assert.equal(same.status, 304);
  assert.equal(await same.text(), "");
  assert.equal(same.headers.get("etag"), etag);
  const preflight = await fetch(server + SUMMARY, {
    method: "OPTIONS",
    headers: {
      origin: "app://verynize",
      "access-control-request-method": "GET",
      "access-control-request-headers": "x-verynize-session,if-none-match",
    },
  });
  assert.match(preflight.headers.get("access-control-allow-headers"), /If-None-Match/);
  assert.equal(preflight.headers.get("access-control-max-age"), "7200");

  // Change feed: nothing since the cursor, then only what changed.
  let cursor = summary.cursor;
  const idle = await read(ana, `${SUMMARY}&since=${cursor}`);
  assert.deepEqual(idle.items, []);
  assert.equal(idle.cursor, cursor);
  const idleTag = (await get(ana, `${SUMMARY}&since=${cursor}`)).headers.get("etag");
  assert.equal(
    (await get(ana, `${SUMMARY}&since=${cursor}`, { "if-none-match": idleTag })).status,
    304,
  );
  const theme = await put(ana, "preference:theme", "light", 1);
  await put(ana, "chat:long", transcript("long", "Landing page v2", 14), long.revision);
  await put(ana, "chat:gone", null, 1);
  const changed = await read(ana, `${SUMMARY}&since=${cursor}`);
  assert.deepEqual(changed.items.map((item) => item.key).sort(), [
    "chat:gone",
    "chat:long",
    "preference:theme",
  ]);
  assert.deepEqual(
    changed.items.find((item) => item.key === "preference:theme"),
    {
      ...theme,
      value: '"light"',
    },
  );
  const updated = changed.items.find((item) => item.key === "chat:long");
  assert.equal(updated.revision, long.revision + 1);
  assert.equal(JSON.parse(updated.summary).chat.count, 14);
  assert.equal(JSON.parse(updated.summary).chat.title, "Landing page v2");
  assert.deepEqual(
    changed.items.find((item) => item.key === "chat:gone"),
    {
      key: "chat:gone",
      value: null,
      revision: 2,
    },
  );
  assert.ok(changed.cursor > cursor, "the cursor advances");
  assert.notEqual(
    (await get(ana, `${SUMMARY}&since=${cursor}`, { "if-none-match": idleTag })).status,
    304,
    "a change invalidates the old ETag",
  );
  cursor = changed.cursor;
  assert.deepEqual((await read(ana, `${SUMMARY}&since=${cursor}`)).items, []);
  assert.deepEqual((await read(budi, `${SUMMARY}&since=0`)).items, []);
  assert.equal((await get(ana, `${SUMMARY}&since=-1`)).status, 400);
  assert.equal((await get(ana, `${SUMMARY}&since=abc`)).status, 400);

  // Writes that race each other still land after the cursor of anything read before them.
  const before = cursor;
  await Promise.all(Array.from({ length: 6 }, (_, i) => put(ana, `preference:race-${i}`, i)));
  const raced = await read(ana, `${SUMMARY}&since=${before}`);
  assert.equal(raced.items.length, 6);
  const db = await mf.getD1Database("DB");
  const stamps = (
    await db
      .prepare(
        "SELECT updatedAt FROM account_state WHERE key LIKE 'preference:race-%' ORDER BY updatedAt",
      )
      .all()
  ).results.map((row) => row.updatedAt);
  assert.equal(new Set(stamps).size, 6, "every write gets its own position in the feed");

  // A large non-chat record is chunked; summary and feed reads join it like the full read.
  const big = { notes: "x".repeat(300000) };
  await put(ana, "preference:big", big);
  const bigFeed = await read(ana, `${SUMMARY}&since=${raced.cursor}`);
  assert.deepEqual(
    JSON.parse(bigFeed.items.find((item) => item.key === "preference:big").value),
    big,
  );

  // Chats stored before summaries existed get one, computed once and kept.
  const { account } = await read(ana, "/api/me");
  const legacy = JSON.stringify(transcript("legacy", "Older chat", 3));
  await db
    .prepare(
      "INSERT INTO account_state (accountId, key, value, revision, updatedAt) VALUES (?, ?, ?, 4, 1)",
    )
    .bind(account.id, "chat:legacy", legacy)
    .run();
  const migrated = (await read(ana, SUMMARY)).items.find((item) => item.key === "chat:legacy");
  assert.equal(migrated.revision, 4);
  assert.equal(JSON.parse(migrated.summary).chat.count, 3);
  const stored = await db
    .prepare("SELECT value, revision FROM account_state WHERE accountId = ? AND key = ?")
    .bind(account.id, "@summary:chat:legacy")
    .first();
  assert.equal(stored.revision, 4);
  assert.equal(stored.value, migrated.summary);
  assert.equal(
    JSON.parse((await read(ana, "/api/me/state/chat%3Alegacy")).item.value).chat.messages.length,
    3,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM account_state WHERE key = '@summary:chat:gone'")
        .first()
    ).n,
    0,
    "deleting a chat removes its summary",
  );
  console.log(
    "PASS account summaries without transcripts, per-chat reads, ETag 304 and the change feed",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
