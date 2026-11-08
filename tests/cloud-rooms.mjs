import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "better-cloud-"));
const options = await cloudOptions(persistence);
let mf = new Miniflare(options);
const request = (route, method = "GET", data, token) =>
  mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
try {
  let response = await request("/api/rooms", "POST", {
    document: { nodes: [{ id: "a", text: "First" }] },
  });
  assert.equal(response.status, 201);
  const room = await response.json(),
    url = "/api/rooms/" + room.id;
  assert.equal((await request(url)).status, 401);
  assert.equal((await request(url, "GET", null, "a".repeat(64))).status, 401);
  response = await request(
    url,
    "PUT",
    { document: { nodes: [{ id: "b" }] }, baseRevision: 0 },
    room.token,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 1);
  assert.equal(
    (await request(url, "PUT", { document: { nodes: [] }, baseRevision: 0 }, room.token)).status,
    409,
  );
  const upgrade = await mf.dispatchFetch("http://local" + url + "/socket?token=" + room.token, {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(upgrade.status, 101);
  const socket = upgrade.webSocket;
  const messages = [];
  socket.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  socket.accept();
  const next = (type, predicate = () => true) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Missing " + type)), 4000);
      const listener = (e) => {
        const value = JSON.parse(e.data);
        if (value.type === type && predicate(value)) {
          clearTimeout(timer);
          socket.removeEventListener("message", listener);
          resolve(value);
        }
      };
      socket.addEventListener("message", listener);
    });
  const presence = next("presence", (v) => v.peers.some((p) => p.name === "Alice"));
  socket.send(JSON.stringify({ type: "presence", name: "Alice", cursor: { x: 10, y: 20 } }));
  assert.equal(
    (await presence).peers.some((p) => p.name === "Alice"),
    true,
  );
  const changed = next("snapshot", (v) => v.revision === 2);
  socket.send(
    JSON.stringify({ type: "update", baseRevision: 1, document: { nodes: [{ id: "c" }] } }),
  );
  assert.equal((await changed).revision, 2);
  const publication = await (await request(url + "/publish", "POST", null, room.token)).json();
  const publicURL = "/api/public/" + publication.publicId;
  assert.equal((await request(publicURL)).status, 200);
  await request(url, "PUT", { document: { nodes: [{ id: "d" }] }, baseRevision: 2 }, room.token);
  assert.equal((await (await request(publicURL)).json()).revision, 2);
  socket.close();
  await mf.dispose();
  mf = new Miniflare(options);
  assert.equal((await (await request(url, "GET", null, room.token)).json()).revision, 3);
  assert.equal((await request(publicURL)).status, 200);
  assert.equal((await request(url + "/publish", "DELETE", null, room.token)).status, 200);
  assert.equal((await request(publicURL)).status, 404);
  const other = await (await request("/api/rooms", "POST", { document: { nodes: [] } })).json();
  assert.equal((await request("/api/rooms/" + other.id, "GET", null, room.token)).status, 401);
  // Invite links (web/cloud-invite.js): owners share an editor (or viewer) link, never their own owner token.
  const invite = await (
    await request(url + "/tokens", "POST", { role: "editor", label: "Editor invite" }, room.token)
  ).json();
  assert.equal(invite.role, "editor");
  assert.match(invite.token, /^[0-9a-f]{64}$/);
  assert.notEqual(invite.token, room.token);
  const joined = await (await request(url, "GET", null, invite.token)).json();
  assert.equal(joined.role, "editor");
  assert.equal(
    (
      await request(
        url,
        "PUT",
        { document: { nodes: [{ id: "e" }] }, baseRevision: joined.revision },
        invite.token,
      )
    ).status,
    200,
  );
  for (const [route, method, body] of /** @type {[string, string, object?][]} */ ([
    ["/tokens", "POST", { role: "owner" }],
    ["/tokens", "POST", { role: "editor" }],
    ["/tokens/rotate", "POST"],
    ["/tokens/" + invite.id, "DELETE"],
  ]))
    assert.equal((await request(url + route, method, body, invite.token)).status, 403, route);
  const ownerAccess = await (await request(url + "/access", "GET", null, room.token)).json();
  assert.ok(
    ownerAccess.links.some(
      (link) => link.id === invite.id && link.role === "editor" && link.label === "Editor invite",
    ),
  );
  for (const token of [room.token, invite.token])
    assert.ok(!JSON.stringify(ownerAccess).includes(token), "link secrets are never listed");
  assert.equal(
    (await (await request(url + "/access", "GET", null, invite.token)).json()).links,
    undefined,
  );
  const viewerInvite = await (
    await request(url + "/tokens", "POST", { role: "viewer", label: "Viewer invite" }, room.token)
  ).json();
  assert.equal((await (await request(url, "GET", null, viewerInvite.token)).json()).role, "viewer");
  assert.equal(
    (
      await request(
        url,
        "PUT",
        { document: { nodes: [] }, baseRevision: joined.revision + 1 },
        viewerInvite.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(url + "/tokens/" + invite.id, "DELETE", null, room.token)).status,
    200,
  );
  assert.equal((await request(url, "GET", null, invite.token)).status, 401);
  assert.equal((await request(url, "GET", null, room.token)).status, 200);
  // Rooms are stored per page: a 3 MB document fits (2 MB per page, 20 MB per document) and joins with one page; JSON without pages keeps a 2 MB limit.
  const pagesDoc = {
    version: 2,
    name: "Big",
    pages: [
      { id: "p1", name: "One", nodes: [{ id: "x", text: "x".repeat(1_500_000) }] },
      { id: "p2", name: "Two", nodes: [{ id: "y", text: "y".repeat(1_500_000) }] },
    ],
  };
  response = await request("/api/rooms", "POST", { document: pagesDoc });
  assert.equal(response.status, 201);
  const bigRoom = await response.json();
  const lazyBig = await (
    await request("/api/rooms/" + bigRoom.id + "?lazy=1", "GET", null, bigRoom.token)
  ).json();
  assert.deepEqual(lazyBig.unloaded, ["p2"]);
  assert.equal(lazyBig.document.pages[1].nodes.length, 0);
  assert.deepEqual(
    (await (await request("/api/rooms/" + bigRoom.id, "GET", null, bigRoom.token)).json()).document,
    pagesDoc,
  );
  assert.equal(
    (await request("/api/rooms", "POST", { document: { blob: "z".repeat(2_200_000) } })).status,
    413,
  );
  let limited = false;
  for (let i = 0; i < 12; i++) {
    const response = await request("/api/rooms", "POST", { document: { nodes: [] } });
    if (response.status === 429) {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
  console.log(
    "PASS cloud authentication, isolated rooms, editor/viewer invite links (no owner powers, secrets never listed, revocable), conflict detection, WebSocket presence/update, frozen publication, restart persistence, unpublish, creation rate limit, per-page storage and limits",
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
