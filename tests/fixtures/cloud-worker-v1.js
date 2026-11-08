// Snapshot-only collaboration Worker as shipped before accounts, roles and operation merging (tests/cloud-accounts.mjs migration fixture).
import { DurableObject } from "cloudflare:workers";
const MAX = 2 * 1024 * 1024;
const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization",
};
const json = (data, status = 200) => Response.json(data, { status, headers });
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
const hash = async (text) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
async function body(request) {
  if (!request.body) throw Error("Missing JSON body");
  const reader = request.body.getReader();
  let total = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX) {
      await reader.cancel();
      throw Error("Document exceeds 2 MB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, pos);
    pos += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function documentText(document) {
  if (document === null || typeof document !== "object")
    throw Error("Document must be a JSON object or array");
  const text = JSON.stringify(document);
  if (new TextEncoder().encode(text).length > MAX - 1024) throw Error("Document exceeds 2 MB");
  return text;
}
export class DesignRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL, public_nonce TEXT, public_document TEXT, public_revision INTEGER)",
    );
  }
  row() {
    return this.ctx.storage.sql.exec("SELECT * FROM room WHERE id=1").toArray()[0];
  }
  snapshot() {
    const row = this.row();
    return { document: JSON.parse(row.document), revision: row.revision };
  }
  async authorized(value) {
    const row = this.row();
    if (!row || typeof value !== "string" || value.length !== 64) return false;
    const candidate = await hash(value);
    const known = Uint8Array.from(JSON.parse(row.token_hash));
    return crypto.subtle.timingSafeEqual(candidate, known);
  }
  async create(document) {
    if (this.row()) return json({ error: "Room exists" }, 409);
    const text = documentText(document),
      secret = token(),
      digest = await hash(secret);
    this.ctx.storage.sql.exec(
      "INSERT INTO room (id,token_hash,document,revision) VALUES (1,?,?,0)",
      JSON.stringify(Array.from(digest)),
      text,
    );
    return json({ token: secret, revision: 0 }, 201);
  }
  broadcast(value) {
    const message = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }
  update(document, baseRevision) {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0)
      throw Error("baseRevision must be a nonnegative integer");
    const text = documentText(document);
    const row = this.row();
    if (row.revision !== baseRevision)
      return json({ error: "Revision conflict", ...this.snapshot() }, 409);
    this.ctx.storage.sql.exec(
      "UPDATE room SET document=?,revision=revision+1 WHERE id=1 AND revision=?",
      text,
      baseRevision,
    );
    const result = this.snapshot();
    this.broadcast({ type: "snapshot", ...result });
    return json(result);
  }
  async fetch(request) {
    try {
      const url = new URL(request.url),
        action = url.pathname;
      const row = this.row();
      if (action === "/create" && request.method === "POST")
        return this.create((await body(request)).document);
      if (action === "/public" && request.method === "GET") {
        if (!row || !row.public_nonce || url.searchParams.get("nonce") !== row.public_nonce)
          return json({ error: "Not found" }, 404);
        return json({ document: JSON.parse(row.public_document), revision: row.public_revision });
      }
      const secret =
        request.headers.get("authorization")?.replace(/^Bearer /, "") ||
        (action === "/socket" ? url.searchParams.get("token") : null);
      if (!(await this.authorized(secret))) return json({ error: "Unauthorized" }, 401);
      if (action === "/socket" && request.method === "GET") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return json({ error: "WebSocket upgrade required" }, 426);
        if (this.ctx.getWebSockets().length >= 32)
          return json({ error: "Room connection limit reached" }, 429);
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        const id = crypto.randomUUID();
        server.serializeAttachment({ id, name: "Guest" });
        server.send(JSON.stringify({ type: "welcome", id }));
        server.send(JSON.stringify({ type: "snapshot", ...this.snapshot() }));
        this.broadcast({ type: "presence", peers: this.peers() });
        return new Response(null, { status: 101, webSocket: client });
      }
      if (action === "/room" && request.method === "GET") return json(this.snapshot());
      if (action === "/room" && request.method === "PUT") {
        const data = await body(request);
        return this.update(data.document, data.baseRevision);
      }
      if (action === "/publish" && request.method === "POST") {
        const current = this.row(),
          nonce = token();
        this.ctx.storage.sql.exec(
          "UPDATE room SET public_nonce=?,public_document=document,public_revision=revision WHERE id=1",
          nonce,
        );
        return json({ nonce, revision: current.revision });
      }
      if (action === "/publish" && request.method === "DELETE") {
        this.ctx.storage.sql.exec(
          "UPDATE room SET public_nonce=NULL,public_document=NULL,public_revision=NULL WHERE id=1",
        );
        return json({ unpublished: true });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  }
  peers() {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter(Boolean);
  }
  async webSocketMessage(ws, message) {
    try {
      if (typeof message !== "string" || message.length > MAX) throw Error("Invalid message size");
      const data = JSON.parse(message);
      if (data.type === "update") {
        const response = this.update(data.document, data.baseRevision);
        if (response.status !== 200)
          ws.send(JSON.stringify({ type: "conflict", ...(await response.json()) }));
      } else if (data.type === "presence") {
        const state = ws.deserializeAttachment();
        const presence = {
          id: state.id,
          name: typeof data.name === "string" ? data.name.slice(0, 80) : "Guest",
          pageId: typeof data.pageId === "string" ? data.pageId.slice(0, 120) : null,
          cursor:
            data.cursor && Number.isFinite(data.cursor.x) && Number.isFinite(data.cursor.y)
              ? { x: data.cursor.x, y: data.cursor.y }
              : null,
        };
        ws.serializeAttachment(presence);
        this.broadcast({ type: "presence", peers: this.peers() });
      } else throw Error("Unknown message type");
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", error: error.message }));
    }
  }
  webSocketClose(ws) {
    this.broadcast({
      type: "presence",
      peers: this.peers().filter((peer) => peer.id !== ws.deserializeAttachment()?.id),
    });
  }
  webSocketError(ws) {
    try {
      ws.close(1011, "Connection error");
    } catch {}
  }
}
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      if (url.pathname === "/api/rooms" && request.method === "POST") {
        const allowed = await env.ROOM_CREATION.limit({
          key: request.headers.get("CF-Connecting-IP") || "local",
        });
        if (!allowed.success)
          return json({ error: "Too many new rooms. Try again in a minute." }, 429);
        const data = await body(request);
        documentText(data.document);
        const id = crypto.randomUUID(),
          stub = env.ROOMS.getByName(id);
        const response = await stub.fetch(
          new Request("https://room/create", { method: "POST", body: JSON.stringify(data) }),
        );
        return json({ id, ...(await response.json()) }, response.status);
      }
      const publicMatch = url.pathname.match(
        new RegExp(`^/api/public/(${uuidPattern}).([0-9a-f]{64})$`),
      );
      if (publicMatch && request.method === "GET")
        return env.ROOMS.getByName(publicMatch[1]).fetch(
          new Request(`https://room/public?nonce=${publicMatch[2]}`),
        );
      const match = url.pathname.match(
        new RegExp(`^/api/rooms/(${uuidPattern})(/socket|/publish)?$`),
      );
      if (match) {
        const action = match[2] || "/room";
        const forward = new URL("https://room" + action);
        if (action === "/socket")
          forward.searchParams.set("token", url.searchParams.get("token") || "");
        const response = await env.ROOMS.getByName(match[1]).fetch(new Request(forward, request));
        if (action === "/publish" && request.method === "POST" && response.ok) {
          const result = await response.json();
          return json({ publicId: `${match[1]}.${result.nonce}`, revision: result.revision });
        }
        return response;
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Verynize API", { status: 200 });
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  },
};
