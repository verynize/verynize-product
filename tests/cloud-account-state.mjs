import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-account-state-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
try {
  const server = (await mf.ready).origin;
  const ana = await passwordUser(server, "state-ana@example.test", "Ana");
  const budi = await passwordUser(server, "state-budi@example.test", "Budi");
  const send = (session, key, value, revision = 0) =>
    fetch(server + "/api/me/state" + (key ? "/" + encodeURIComponent(key) : ""), {
      method: key ? "PUT" : "GET",
      headers: {
        "content-type": "application/json",
        ...(session ? { "x-verynize-session": session } : {}),
      },
      ...(key
        ? {
            body: JSON.stringify({
              value: value === null ? null : JSON.stringify(value),
              revision,
            }),
          }
        : {}),
    });
  assert.equal((await send(null)).status, 401);
  assert.equal((await send(ana, "preference:theme", "light")).status, 200);
  assert.equal(
    (await send(ana, "chat:one", { messages: [{ role: "user", text: "A private transcript" }] }))
      .status,
    200,
  );
  assert.deepEqual(
    (await (await send(budi)).json()).items,
    [],
    "another account cannot read private state",
  );
  const writes = await Promise.all(
    ["dark", "system"].map((value) => send(ana, "preference:theme", value, 1)),
  );
  assert.deepEqual(
    writes.map((r) => r.status).sort((a, b) => a - b),
    [200, 409],
    "concurrent edits use atomic revision checks",
  );
  assert.equal((await send(ana, "preference:theme", "stale", 1)).status, 409);
  assert.equal((await send(budi, "preference:theme", "own theme")).status, 200);
  assert.equal((await send(ana, "chat:one", null, 1)).status, 200);
  const items = (await (await send(ana)).json()).items;
  assert.equal(
    items.find((item) => item.key === "chat:one").value,
    null,
    "deleted chats keep a revision tombstone",
  );
  assert.equal((await send(ana, "session:secret", "no")).status, 400);
  assert.equal((await send(ana, "preference:theme", "no", -1)).status, 400);
  // A transcript larger than both the old HTTP limit and D1's single-row limit.
  const large = {
    text: "a".repeat(131061) + '🌴\\"'.repeat(400000),
    attachment: "data:image/png;base64," + "A".repeat(500000),
  };
  const largeResponse = await send(ana, "chat:large", large);
  assert.equal(largeResponse.status, 200, await largeResponse.clone().text());
  assert.deepEqual(JSON.parse((await largeResponse.json()).item.value), large);
  const readLarge = async () =>
    (await (await send(ana)).json()).items.find((item) => item.key === "chat:large");
  assert.deepEqual(
    JSON.parse((await readLarge()).value),
    large,
    "large Unicode transcript round-trips intact",
  );
  const db = await mf.getD1Database("DB");
  const chunkCount = async () =>
    (
      await db
        .prepare("SELECT count(*) AS count FROM account_state WHERE key LIKE '@chunk:%'")
        .first()
    ).count;
  const beforeChunks = await chunkCount();
  await db.exec(
    "CREATE TRIGGER reject_test_chunk BEFORE INSERT ON account_state WHEN NEW.key LIKE '@chunk:%' BEGIN SELECT RAISE(ABORT, 'test chunk failure'); END",
  );
  assert.equal(
    (await send(ana, "chat:large", { ...large, title: "must roll back" }, 1)).status,
    500,
    "database write failures are server errors",
  );
  await db.exec("DROP TRIGGER reject_test_chunk");
  assert.deepEqual(
    JSON.parse((await readLarge()).value),
    large,
    "failed chunk write rolls back the head too",
  );
  assert.equal(await chunkCount(), beforeChunks, "failed batch leaves no orphan chunks");
  const competing = await Promise.all([
    send(ana, "chat:large", { ...large, title: "A" }, 1),
    send(ana, "chat:large", { ...large, title: "B" }, 1),
  ]);
  assert.deepEqual(
    competing.map((r) => r.status).sort((a, b) => a - b),
    [200, 409],
  );
  const winner = JSON.parse((await readLarge()).value);
  assert.ok(["A", "B"].includes(winner.title));
  assert.equal(winner.text, large.text, "a stale writer cannot delete the winner's chunks");
  assert.equal(
    await chunkCount(),
    beforeChunks,
    "replacement and stale writes leave only the current chunks",
  );
  assert.ok(
    (await (await send(ana)).json()).items.every((item) => !item.key.startsWith("@chunk:")),
  );
  assert.ok(!(await (await send(budi)).json()).items.some((item) => item.key === "chat:large"));
  assert.equal((await send(ana, "@chunk:reserved:0", "no")).status, 400);
  assert.equal((await send(ana, "chat:large", { text: "short again" }, 2)).status, 200);
  assert.deepEqual(JSON.parse((await readLarge()).value), { text: "short again" });
  assert.equal((await send(ana, "chat:large", large, 3)).status, 200);
  assert.equal((await send(ana, "chat:large", null, 4)).status, 200);
  assert.equal((await readLarge()).value, null);
  assert.equal(await chunkCount(), 0, "deletion reclaims all chunks");
  console.log(
    "PASS private account state, independent records, atomic conflicts and deletion tombstones",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
