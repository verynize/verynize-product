// HTTP and WebSocket front end on Node: one port serving the Worker's fetch handler, the web
// static assets and room sockets. Requests become WHATWG Requests, so cloud/worker.js runs as is.
import http from "node:http";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
import { pendingUpgrade, UPGRADED } from "./actors.js";
import { MESSAGE_BYTES } from "../../limits.js";

// Paths Cloudflare runs the Worker for before looking at static assets (cloudflare.config.ts).
const WORKER_FIRST = [
  /^\/api\//,
  /^\/u\//,
  /^\/apps\//,
  /^\/passkey$/,
  /^\/passkey\.js$/,
  /^\/account\//,
];
// Room socket messages carry up to a whole document (cloud/limits.js).
const MAX_SOCKET_MESSAGE = MESSAGE_BYTES;

/**
 * @param {object} options
 * @param {{fetch(request: Request, env: object): Promise<Response>}} options.worker
 * @param {object} options.env the bindings (cloud/platform/node/env.js)
 * @param {{match(request: Request): Promise<Response|null>}} [options.assets] static files
 * @param {string} [options.publicUrl] fixed origin for request URLs (PUBLIC_URL)
 * @param {boolean} [options.trustProxy] take X-Forwarded-Proto/Host from a reverse proxy
 * @param {string} [options.clientIpHeader] header a trusted proxy sets to the client address
 */
export function createServer({ worker, env, assets, publicUrl, trustProxy, clientIpHeader }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_SOCKET_MESSAGE });
  const fixedOrigin = publicUrl ? new URL(publicUrl).origin : null;
  const ipHeader = clientIpHeader ? clientIpHeader.toLowerCase() : null;

  function toRequest(incoming) {
    const headers = new Headers();
    for (let i = 0; i < incoming.rawHeaders.length; i += 2)
      headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
    let origin = fixedOrigin;
    if (!origin) {
      const forwardedHost = trustProxy && headers.get("x-forwarded-host")?.split(",")[0].trim();
      const forwardedProto = trustProxy && headers.get("x-forwarded-proto")?.split(",")[0].trim();
      const proto = forwardedProto || (incoming.socket.encrypted ? "https" : "http");
      origin = `${proto}://${forwardedHost || headers.get("host") || "localhost"}`;
    }
    // The router reads the client address from CF-Connecting-IP. Only a configured proxy header
    // is trusted; anything a client sent itself is replaced by the socket address.
    const proxied = ipHeader && headers.get(ipHeader)?.split(",")[0].trim();
    headers.set("cf-connecting-ip", proxied || incoming.socket.remoteAddress || "unknown");
    const method = incoming.method || "GET";
    const hasBody = !["GET", "HEAD"].includes(method);
    return new Request(new URL(incoming.url || "/", origin), {
      method,
      headers,
      body: hasBody ? Readable.toWeb(incoming) : undefined,
      duplex: hasBody ? "half" : undefined,
    });
  }

  async function respond(request) {
    const { pathname } = new URL(request.url);
    if (assets && !WORKER_FIRST.some((pattern) => pattern.test(pathname))) {
      const file = await assets.match(request);
      if (file) return file;
    }
    return worker.fetch(request, env);
  }

  async function send(response, outgoing, method) {
    const headers = {};
    for (const [name, value] of response.headers) {
      if (name === "set-cookie") continue;
      headers[name] = value;
    }
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) headers["set-cookie"] = cookies;
    outgoing.writeHead(response.status, response.statusText || undefined, headers);
    if (!response.body || method === "HEAD") {
      await response.body?.cancel().catch(() => {});
      return void outgoing.end();
    }
    const body = Readable.fromWeb(response.body);
    body.on("error", () => outgoing.destroy());
    body.pipe(outgoing);
  }

  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const request = toRequest(incoming);
      await send(await respond(request), outgoing, request.method);
      // A refusal answered before reading the body (413 from Content-Length) must not reset
      // the connection while the client is still sending: discard the rest, up to a bound.
      if (!incoming.complete && !incoming.destroyed) {
        let discarded = 0;
        incoming.removeAllListeners("data");
        incoming.on("data", (chunk) => {
          discarded += chunk.length;
          if (discarded > 64 * 1024 * 1024) incoming.destroy();
        });
        incoming.resume();
      }
    } catch (error) {
      console.error("request failed", incoming.url?.split("?")[0], error?.message);
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: "Request failed" }));
      } else outgoing.destroy();
    }
  });

  server.on("upgrade", async (incoming, socket, head) => {
    socket.on("error", () => {});
    const upgrade = { socket: null };
    try {
      const request = toRequest(incoming);
      const response = await pendingUpgrade.run(upgrade, () => worker.fetch(request, env));
      if (response[UPGRADED] && upgrade.socket) {
        if (socket.destroyed) return upgrade.socket.abandon();
        sockets.handleUpgrade(incoming, socket, head, (ws) => upgrade.socket.attach(ws));
        return;
      }
      upgrade.socket?.abandon();
      const body = Buffer.from(await response.arrayBuffer());
      const lines = [`HTTP/1.1 ${response.status} ${http.STATUS_CODES[response.status] || ""}`];
      for (const [name, value] of response.headers) lines.push(`${name}: ${value}`);
      lines.push(`content-length: ${body.byteLength}`, "connection: close", "", "");
      socket.end(Buffer.concat([Buffer.from(lines.join("\r\n")), body]));
    } catch (error) {
      upgrade.socket?.abandon();
      console.error("upgrade failed", incoming.url?.split("?")[0], error?.message);
      socket.end(
        "HTTP/1.1 500 Internal Server Error\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
      );
    }
  });

  return server;
}
