// File covers use real local R2 uploads and D1 metadata, across runtime restarts.
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-thumbnails-"));
const options = await cloudOptions(persistence);
let mf = new Miniflare(options);
const origin = "http://localhost";
const call = (route, { method = "GET", body, token } = {}) =>
  mf.dispatchFetch(route.startsWith("http") ? route : origin + route, {
    method,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(body !== undefined && !(body instanceof Uint8Array)
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(body !== undefined
      ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) }
      : {}),
  });
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const register = async (room, bytes, contentType = "image/png") => {
  const response = await call(`/api/rooms/${room.id}/assets`, {
    method: "POST",
    token: room.token,
    body: {
      contentType,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    },
  });
  assert.equal(response.status, 201);
  return response.json();
};
const createRoom = async () =>
  (
    await call("/api/rooms", {
      method: "POST",
      body: { document: { pages: [] } },
    })
  ).json();
try {
  const room = await createRoom();
  const other = await createRoom();
  const base = `/api/rooms/${room.id}`;
  const route = `${base}/thumbnail`;
  const put = (body, token = room.token) => call(route, { method: "PUT", body, token });
  const read = () => call(route, { token: room.token });
  assert.deepEqual(await (await read()).json(), { thumbnail: null });
  assert.equal((await call(route)).status, 401);
  assert.equal((await call(route, { token: other.token })).status, 401);
  const asset = await register(room, PNG);
  assert.equal(
    (await put({ assetId: asset.id, nodeId: "cover" })).status,
    404,
    "pending upload refused",
  );
  assert.equal((await call(asset.uploadUrl, { method: "PUT", body: PNG })).status, 200);
  assert.equal(
    (
      await call(`/api/rooms/${other.id}/thumbnail`, {
        method: "PUT",
        token: other.token,
        body: { assetId: asset.id, nodeId: "cover" },
      })
    ).status,
    404,
    "cross-room reference refused",
  );
  for (const nodeId of [null, "", " ", 123, "x".repeat(201)])
    assert.equal((await put({ assetId: asset.id, nodeId })).status, 400);
  assert.equal((await put(null)).status, 400);
  assert.equal((await put({ assetId: "invalid", nodeId: "cover" })).status, 400);
  const response = await put({ assetId: asset.id, nodeId: "cover" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const { thumbnail } = await response.json();
  assert.equal(thumbnail.assetId, asset.id);
  assert.equal(thumbnail.nodeId, "cover");
  assert.equal(thumbnail.pageId, null, "existing custom-cover requests remain compatible");
  assert.equal(thumbnail.contentType, "image/png");
  assert.equal(thumbnail.url, asset.url);
  assert.deepEqual(new Uint8Array(await (await call(thumbnail.url)).arrayBuffer()), PNG);
  for (const role of ["viewer", "commenter", "editor"]) {
    const member = await (
      await call(`${base}/tokens`, {
        method: "POST",
        token: room.token,
        body: { role },
      })
    ).json();
    assert.equal((await call(route, { token: member.token })).status, 200);
    const expected = role === "editor" ? 200 : 403;
    assert.equal(
      (await put({ assetId: asset.id, nodeId: "cover" }, member.token)).status,
      expected,
    );
    assert.equal(
      (await put({ assetId: asset.id, nodeId: null, pageId: "first-page" }, member.token)).status,
      expected,
      "default covers use the same editor permissions",
    );
    if (role !== "editor")
      assert.equal((await call(route, { method: "DELETE", token: member.token })).status, 403);
  }
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const vector = await register(room, svg, "image/svg+xml");
  assert.equal((await call(vector.uploadUrl, { method: "PUT", body: svg })).status, 200);
  assert.equal((await put({ assetId: vector.id, nodeId: "cover" })).status, 415);
  assert.equal(
    (await put({ assetId: asset.id, nodeId: "new-cover" })).status,
    200,
    "upsert replaces selection",
  );
  await mf.dispose();
  mf = new Miniflare(options);
  const persisted = await (await read()).json();
  assert.equal(persisted.thumbnail.nodeId, "new-cover");
  assert.equal(persisted.thumbnail.url, asset.url);
  assert.equal((await call(persisted.thumbnail.url)).status, 200);
  // Apply the shipped upgrade to a populated 0010 table, rather than only testing a fresh DB.
  const db = await mf.getD1Database("DB");
  const previousSchema = await fs.readFile(
    new URL("../cloud/migrations/0010_room_thumbnails.sql", import.meta.url),
    "utf8",
  );
  await db.batch([
    db.prepare("DROP TABLE room_thumbnail"),
    db.prepare(previousSchema),
    db
      .prepare("INSERT INTO room_thumbnail (roomId,assetId,nodeId,updatedAt) VALUES (?,?,?,?)")
      .bind(room.id, asset.id, "new-cover", persisted.thumbnail.updatedAt),
  ]);
  const upgrade = await fs.readFile(
    new URL("../cloud/migrations/0011_default_room_thumbnails.sql", import.meta.url),
    "utf8",
  );
  await db.batch(
    upgrade
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  const upgraded = (await (await read()).json()).thumbnail;
  assert.equal(upgraded.nodeId, "new-cover", "upgrade preserves existing custom selection");
  assert.equal(upgraded.pageId, null);
  assert.equal(upgraded.url, asset.url);
  assert.equal(upgraded.updatedAt, persisted.thumbnail.updatedAt);
  for (const pageId of [undefined, null, "", " ", 123, "x".repeat(201)])
    assert.equal((await put({ assetId: asset.id, nodeId: null, pageId })).status, 400);
  assert.equal(
    (await put({ assetId: asset.id, nodeId: "cover", pageId: 123 })).status,
    400,
    "custom covers cannot carry an invalid optional page ID",
  );
  const defaultResponse = await put({ assetId: asset.id, nodeId: null, pageId: "first-page" });
  assert.equal(defaultResponse.status, 200);
  const automatic = (await defaultResponse.json()).thumbnail;
  assert.equal(automatic.nodeId, null);
  assert.equal(automatic.pageId, "first-page");
  assert.equal(automatic.url, asset.url);
  assert.deepEqual(new Uint8Array(await (await call(automatic.url)).arrayBuffer()), PNG);
  await mf.dispose();
  mf = new Miniflare(options);
  const defaultPersisted = (await (await read()).json()).thumbnail;
  assert.equal(defaultPersisted.nodeId, null, "default selection survives restart");
  assert.equal(defaultPersisted.pageId, "first-page");
  assert.equal(defaultPersisted.url, asset.url);
  assert.equal(
    (await put({ assetId: asset.id, nodeId: "cover" })).status,
    200,
    "a custom cover replaces a default cover",
  );
  assert.equal((await (await read()).json()).thumbnail.pageId, null);
  assert.equal(
    (await put({ assetId: asset.id, nodeId: null, pageId: "new-first-page" })).status,
    200,
    "a new first page replaces an old default cover",
  );
  assert.equal((await (await read()).json()).thumbnail.pageId, "new-first-page");
  assert.equal((await call(route, { method: "DELETE", token: room.token })).status, 200);
  assert.deepEqual(await (await read()).json(), { thumbnail: null });
  assert.equal(
    (await call(route, { method: "DELETE", token: room.token })).status,
    200,
    "clear is idempotent",
  );
  assert.equal((await call(asset.url)).status, 200, "clearing keeps reused asset bytes");
  console.log(
    "PASS cloud thumbnails: real R2 bytes, persistent custom/default metadata, permissions, validation, replace and restore",
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
