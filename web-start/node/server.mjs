#!/usr/bin/env node
// Node server for the web app built by `npm run build:web:node` (vite.node.config.ts).
//
//   node web-start/node/server.mjs [--dist dist/web-node]
//
// Environment:
//   PORT, HOST              listen address (default 3000, 127.0.0.1)
//   VERYNIZE_BACKEND_URL    origin of the cloud backend, e.g. http://127.0.0.1:8787. Backend paths
//                           (web-start/worker-paths.mjs: /api/*, /u/*, /apps/*, /passkey,
//                           /passkey.js, /account/*) and their WebSocket upgrades are forwarded
//                           there. Unset: those paths answer 502.
//
// Order: backend paths → static files from <dist>/client → the Start request handler.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { isWorkerPath } from "../worker-paths.mjs";
import { contentType } from "../build/legacy-web.mjs";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
]);

/**
 * @param {{ dist: string, backend?: string, log?: (message: string) => void }} options
 * @returns {Promise<http.Server>} a server that is not listening yet
 */
export async function createWebServer({ dist, backend, log = () => {} }) {
  const clientDir = path.resolve(dist, "client");
  const serverEntry = path.resolve(dist, "server", "server.js");
  if (!fs.existsSync(serverEntry))
    throw new Error(`Missing ${serverEntry}: run npm run build:web:node`);
  const start = (await import(pathToFileURL(serverEntry).href)).default;
  const backendURL = backend ? new URL(backend) : undefined;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (isWorkerPath(url.pathname)) return proxy(req, res);
      if (await serveStatic(url.pathname, req, res)) return;
      await respond(res, await start.fetch(toRequest(req)), req.method);
    } catch (error) {
      log(`request failed ${req.url}: ${error?.stack ?? error}`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  // Upgraded sockets leave the HTTP server's bookkeeping; close them with the server.
  const tunnels = new Set();
  server.on("close", () => {
    for (const socket of tunnels) socket.destroy();
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!backendURL || !isWorkerPath(url.pathname)) {
      socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n");
      return;
    }
    // Forward the upgrade request verbatim and splice the two sockets.
    const secure = backendURL.protocol === "https:";
    const port = Number(backendURL.port) || (secure ? 443 : 80);
    const upstream = secure
      ? tls.connect({ host: backendURL.hostname, port, servername: backendURL.hostname })
      : net.connect({ host: backendURL.hostname, port });
    upstream.once(secure ? "secureConnect" : "connect", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        lines.push(
          `${name}: ${name.toLowerCase() === "host" ? backendURL.host : req.rawHeaders[i + 1]}`,
        );
      }
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
    tunnels.add(socket).add(upstream);
    const close = () => {
      socket.destroy();
      upstream.destroy();
      tunnels.delete(socket);
      tunnels.delete(upstream);
    };
    socket.on("close", close);
    upstream.on("close", close);
    upstream.on("error", close);
    socket.on("error", close);
  });

  function proxy(req, res) {
    if (!backendURL) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "No backend configured (set VERYNIZE_BACKEND_URL)" }));
      return;
    }
    const headers = { ...req.headers, host: backendURL.host };
    for (const name of HOP_BY_HOP) delete headers[name];
    // The public origin, for a backend that trusts this proxy (TRUST_PROXY): same-origin checks such as the model
    // API's (/api/ai/*) compare the browser's Origin with it. An outer proxy's values are kept.
    if (req.headers.host) headers["x-forwarded-host"] ??= req.headers.host;
    headers["x-forwarded-proto"] ??= req.socket.encrypted ? "https" : "http";
    const forwarded = req.socket.remoteAddress;
    if (forwarded)
      headers["x-forwarded-for"] = headers["x-forwarded-for"]
        ? `${headers["x-forwarded-for"]}, ${forwarded}`
        : forwarded;
    const upstream = (backendURL.protocol === "https:" ? https : http).request(
      new URL(req.url ?? "/", backendURL),
      { method: req.method, headers },
      (response) => {
        const out = { ...response.headers };
        for (const name of HOP_BY_HOP) delete out[name];
        res.writeHead(response.statusCode ?? 502, out);
        response.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      log(`backend request failed ${req.url}: ${error.message}`);
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Backend unavailable" }));
    });
    req.pipe(upstream);
  }

  async function serveStatic(pathname, req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    let relative;
    try {
      relative = decodeURIComponent(pathname).slice(1);
    } catch {
      return false;
    }
    const file = path.join(clientDir, relative);
    if (!relative || !file.startsWith(clientDir + path.sep)) return false;
    const stat = await fs.promises.stat(file).catch(() => undefined);
    if (!stat?.isFile()) return false;
    res.writeHead(200, {
      "content-type": contentType(file),
      "content-length": stat.size,
      // Start chunks and generated legacy copies are content-hashed. Fixed-name originals,
      // including web/assets/fonts, keep revalidating.
      "cache-control":
        /^assets\/(?:[^/]+-[\w-]{8}\.(?:js|css)|legacy\/[^/]+-[a-f0-9]{16}\.[\w]+)$/.test(relative)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
  }

  return server;
}

function toRequest(req) {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
  return new Request(url, { method: req.method, headers, body, duplex: "half" });
}

async function respond(res, response, method) {
  const headers = {};
  response.headers.forEach((value, name) => {
    if (name === "set-cookie") return;
    headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, response.statusText, headers);
  if (!response.body || method === "HEAD") return res.end();
  Readable.fromWeb(response.body).pipe(res);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const flag = process.argv.indexOf("--dist");
  const dist = path.resolve(flag > 0 ? process.argv[flag + 1] : "dist/web-node");
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const backend = process.env.VERYNIZE_BACKEND_URL || undefined;
  const server = await createWebServer({ dist, backend, log: console.error });
  server.listen(port, host, () => {
    const address = server.address();
    console.log(
      `Verynize web on http://${host}:${typeof address === "object" ? address?.port : port}`,
    );
    console.log(
      backend ? `Backend paths → ${backend}` : "No VERYNIZE_BACKEND_URL: backend paths answer 502",
    );
  });
}
