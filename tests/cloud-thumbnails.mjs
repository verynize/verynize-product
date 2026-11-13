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
/** Object keys under a prefix of the asset bucket (R2 on workerd, the blob directory on Node). */
async function roomObjects(prefix) {
  if (typeof mf.getR2Bucket === "function") {
    const bucket = await mf.getR2Bucket("ASSETS_BUCKET");
    return (await bucket.list({ prefix })).objects.map((object) => object.key);
  }
  const root = path.join(persistence, "blobs", "verynize-assets");
  const found = [];
  const walk = async (folder) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (!/\.(meta\.json|tmp)$/.test(entry.name))
        found.push(path.relative(root, file).split(path.sep).join("/"));
    }
  };
  await walk(path.join(root, prefix));
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
/** One object's bytes, or null when it does not exist. */
async function objectBytes(key) {
  if (typeof mf.getR2Bucket === "function") {
    const object = await (await mf.getR2Bucket("ASSETS_BUCKET")).get(key);
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }
  const file = path.join(persistence, "blobs", "verynize-assets", ...key.split("/"));
  return fs.readFile(file).then(
    (bytes) => new Uint8Array(bytes),
    () => null,
  );
}
const call = (route, { method = "GET", body, token, headers = {} } = {}) =>
  mf.dispatchFetch(route.startsWith("http") ? route : origin + route, {
    method,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(body !== undefined && !(body instanceof Uint8Array)
        ? { "content-type": "application/json" }
        : {}),
      ...headers,
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
  const key = `rooms/${room.id}/thumbnail`;
  const imageRoute = `${route}/image`;
  const put = (
    bytes = PNG,
    query = "nodeId=cover",
    token = room.token,
    contentType = "image/png",
  ) =>
    call(`${route}?${query}`, {
      method: "PUT",
      body: bytes,
      token,
      headers: { "content-type": contentType },
    });
  const read = () => call(route, { token: room.token });
  const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  const bytesOf = async (url, options) => {
    const response = await call(url, options);
    assert.equal(response.status, 200);
    return new Uint8Array(await response.arrayBuffer());
  };
  const inventory = async () => {
    const db = await mf.getD1Database("DB");
    const assets = await db
      .prepare("SELECT count(*) AS total FROM room_asset WHERE roomId = ?")
      .bind(room.id)
      .first();
    return { assets: assets.total, keys: await roomObjects(`rooms/${room.id}/`) };
  };
  assert.deepEqual(await (await read()).json(), { thumbnail: null });
  for (const token of [undefined, other.token]) {
    for (const endpoint of [route, imageRoute])
      assert.equal((await call(endpoint, { token })).status, 401);
    assert.equal((await put(PNG, "nodeId=cover", token || "invalid")).status, 401);
    assert.equal((await call(route, { method: "DELETE", token })).status, 401);
  }
  const response = await put();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const { thumbnail } = await response.json();
  assert.equal(thumbnail.nodeId, "cover");
  assert.equal(thumbnail.pageId, null);
  assert.equal(thumbnail.sha256, digest(PNG));
  assert.equal(thumbnail.size, PNG.length);
  assert.equal(thumbnail.contentType, "image/png");
  assert.ok(!("assetId" in thumbnail));
  assert.deepEqual(await bytesOf(thumbnail.url), PNG);
  assert.deepEqual(await bytesOf(imageRoute, { token: room.token }), PNG);
  assert.deepEqual(await bytesOf(`${imageRoute}?token=${room.token}`), PNG);
  const served = await call(thumbnail.url);
  assert.equal(served.headers.get("etag"), `"${digest(PNG)}"`);
  assert.equal(served.headers.get("cache-control"), "private, no-cache");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await call(thumbnail.url, { method: "HEAD" })).status, 200);
  assert.equal(
    (await call(thumbnail.url, { headers: { "if-none-match": `W/"${digest(PNG)}"` } })).status,
    304,
  );
  const forged = new URL(thumbnail.url);
  forged.searchParams.set("sig", "0".repeat(64));
  assert.equal((await call(forged.href)).status, 403);
  forged.searchParams.set("sig", new URL(thumbnail.url).searchParams.get("sig"));
  forged.pathname = forged.pathname.replace(room.id, other.id);
  assert.equal((await call(forged.href)).status, 403);
  for (const role of ["viewer", "commenter", "editor"]) {
    const member = await (
      await call(`${base}/tokens`, {
        method: "POST",
        token: room.token,
        body: { role },
      })
    ).json();
    assert.equal((await call(route, { token: member.token })).status, 200);
    assert.deepEqual(await bytesOf(imageRoute, { token: member.token }), PNG);
    assert.deepEqual(await bytesOf(`${imageRoute}?token=${member.token}`), PNG);
    const expected = role === "editor" ? 200 : 403;
    assert.equal((await put(PNG, "nodeId=cover", member.token)).status, expected);
    assert.equal((await put(PNG, "pageId=first-page", member.token)).status, expected);
    assert.equal((await call(route, { method: "DELETE", token: member.token })).status, expected);
    if (role === "editor") assert.equal((await put()).status, 200);
  }
  for (const query of [
    "",
    "nodeId=",
    "nodeId=%20",
    "pageId=",
    "pageId=%20",
    `nodeId=${"x".repeat(201)}`,
    `pageId=${"x".repeat(201)}`,
    "nodeId=cover&pageId=%20",
  ])
    assert.equal((await put(PNG, query)).status, 400, query);
  for (const type of ["application/json", "image/svg+xml", "image/gif", "text/plain", ""])
    assert.equal((await put(PNG, "nodeId=cover", room.token, type)).status, 415, type);
  assert.equal((await put(new Uint8Array([1, 2, 3]))).status, 415);
  assert.equal((await put(PNG, "nodeId=cover", room.token, "image/jpeg")).status, 415);
  assert.equal((await put(new Uint8Array())).status, 400);
  assert.equal((await put(new Uint8Array(2 * 1024 * 1024 + 1))).status, 413);
  assert.deepEqual(await bytesOf(thumbnail.url), PNG, "invalid writes preserve previous image");
  // Exercise every accepted magic signature with real R2 byte roundtrips.
  for (const [contentType, bytes] of [
    ["image/jpeg", new Uint8Array([255, 216, 255, 224])],
    ["image/webp", new TextEncoder().encode("RIFF1234WEBP")],
  ]) {
    const result = await put(bytes, "nodeId=cover", room.token, contentType);
    assert.equal(result.status, 200);
    const image = (await result.json()).thumbnail;
    assert.equal(image.contentType, contentType);
    assert.deepEqual(await bytesOf(image.url), bytes);
  }
  let latest;
  let latestBytes;
  for (let i = 0; i < 50; i++) {
    latestBytes = new Uint8Array([...PNG, i]);
    const result = await put(latestBytes, "nodeId=&pageId=first-page");
    assert.equal(result.status, 200);
    latest = (await result.json()).thumbnail;
    assert.equal(latest.sha256, digest(latestBytes));
    assert.deepEqual(await inventory(), { assets: 0, keys: [key] });
  }
  assert.equal(latest.nodeId, null);
  assert.equal(latest.pageId, "first-page");
  assert.notEqual(latest.url, thumbnail.url);
  assert.equal((await call(thumbnail.url)).status, 404, "old bytes are gone");
  const staleSignature = new URL(thumbnail.url);
  staleSignature.searchParams.set("v", latest.sha256);
  assert.equal(
    (await call(staleSignature.href)).status,
    403,
    "old signature cannot read replacement",
  );
  assert.deepEqual(await bytesOf(latest.url), latestBytes);
  assert.deepEqual(await objectBytes(key), latestBytes);
  assert.equal((await read()).headers.get("cache-control"), "private, no-store");
  await mf.dispose();
  mf = new Miniflare(options);
  assert.deepEqual((await (await read()).json()).thumbnail, latest);
  assert.deepEqual(await bytesOf(latest.url), latestBytes);
  assert.deepEqual(await inventory(), { assets: 0, keys: [key] });
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_, i) => put(new Uint8Array([...PNG, 100 + i]))),
  );
  for (const result of concurrent) assert.equal(result.status, 200);
  const winner = (await (await read()).json()).thumbnail;
  assert.equal(
    digest(await bytesOf(winner.url)),
    winner.sha256,
    "concurrent writes keep metadata and bytes together",
  );
  await Promise.all([
    put(PNG),
    call(route, { method: "DELETE", token: room.token }),
    put(new Uint8Array([...PNG, 200])),
  ]);
  const afterRace = (await (await read()).json()).thumbnail;
  if (afterRace) assert.equal(digest(await bytesOf(afterRace.url)), afterRace.sha256);
  else assert.equal(await objectBytes(key), null);
  const asset = await register(room, PNG);
  assert.equal((await call(asset.uploadUrl, { method: "PUT", body: PNG })).status, 200);
  assert.deepEqual(await bytesOf(asset.url), PNG);
  assert.equal((await inventory()).assets, 1, "normal assets still upload after 50 covers");
  assert.equal((await put(PNG, "nodeId=custom&pageId=first-page")).status, 200);
  assert.equal((await (await read()).json()).thumbnail.nodeId, "custom");
  assert.equal(
    (await put(PNG, "pageId=first-page")).status,
    200,
    "restore replaces custom with default",
  );
  assert.equal((await (await read()).json()).thumbnail.nodeId, null);
  for (let i = 0; i < 2; i++) {
    assert.equal((await call(route, { method: "DELETE", token: room.token })).status, 200);
    assert.deepEqual(await (await read()).json(), { thumbnail: null });
    assert.equal(await objectBytes(key), null);
  }
  assert.equal((await call(latest.url)).status, 404);
  assert.equal((await call(imageRoute, { token: room.token })).status, 404);
  assert.deepEqual(await bytesOf(asset.url), PNG, "deleting cover preserves independent assets");
  const db = await mf.getD1Database("DB");
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS total FROM room_thumbnail WHERE roomId=?")
        .bind(room.id)
        .first()
    ).total,
    0,
  );
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO room_thumbnail(roomId,sha256,contentType,size,updatedAt) VALUES(?,?,?,?,?)",
      )
      .bind(room.id, digest(PNG), "image/png", PNG.length, Date.now())
      .run(),
    /CHECK/,
  );
  console.log(
    "PASS cloud thumbnails: R2 readback, replace/delete, auth/signatures, validation, restart, 50 writes use zero asset slots and one object; normal assets work",
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
