// Loopback Streamable-HTTP transport for the Verynize MCP tools, plus the small "bridge
// file" protocol that lets the stdio server find a running desktop app.
//
// Security model: binds to 127.0.0.1 only; every request needs `Authorization: Bearer <token>`
// (a random per-launch secret); requests with a browser Origin header or a foreign Host header
// are refused, which blocks DNS-rebinding and drive-by pages.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const newToken = () => randomBytes(32).toString("base64url");
const MAX_BODY = 25 * 1024 * 1024;

function reject(res, status, message, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}
function authorized(header, token) {
  const match = /^Bearer\s+(\S+)$/i.exec(header || "");
  if (!match) return false;
  const given = Buffer.from(match[1]),
    expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Start the HTTP endpoint. `makeServer({headers})` must return a fresh, unconnected McpServer per
 * request (stateless mode); headers are the request's (lower-cased), e.g. for a per-client access
 * level. Resolves to {url, port, token, close()}.
 */
export async function startHttpServer({
  makeServer,
  token = newToken(),
  port = 0,
  maxBody = MAX_BODY,
  onError = () => {},
}) {
  if (typeof token !== "string" || token.length < 16)
    throw new Error("Bridge token must be at least 16 characters");
  let allowedHosts = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/mcp") return reject(res, 404, "Not found");
      if (!allowedHosts.has(String(req.headers.host || "").toLowerCase()))
        return reject(res, 403, "Forbidden host");
      if (req.headers.origin) return reject(res, 403, "Browser origins are not allowed");
      if (!authorized(req.headers.authorization, token))
        return reject(res, 401, "Missing or invalid bearer token", {
          "www-authenticate": 'Bearer realm="verynize"',
        });
      if (req.method !== "POST") return reject(res, 405, "Method not allowed", { allow: "POST" });
      let body;
      try {
        body = JSON.parse(await readBody(req, maxBody));
      } catch (error) {
        return reject(res, error.status || 400, error.status ? error.message : "Invalid JSON body");
      }
      const mcp = makeServer({ headers: req.headers });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        transport.close().catch(() => {});
        mcp.close().catch(() => {});
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      onError(error);
      if (!res.headersSent) reject(res, 500, "Internal error");
    }
  });
  server.requestTimeout = 120_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const actual = server.address().port;
  allowedHosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  return {
    url: `http://127.0.0.1:${actual}/mcp`,
    port: actual,
    token,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// Bridge file: {url, token, pid, version} written with mode 0600 into the app's user-data folder.

export function defaultBridgeFile(
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
) {
  if (env.VERYNIZE_MCP_FILE) return env.VERYNIZE_MCP_FILE;
  const base =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : platform === "win32"
        ? env.APPDATA || path.join(home, "AppData", "Roaming")
        : env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "Verynize", "mcp.json");
}

export async function writeBridgeFile(file, info) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(
    temp,
    JSON.stringify(
      { ...info, pid: info.pid ?? process.pid, written: new Date().toISOString() },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function readBridgeFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 4096) return null;
    const info = JSON.parse(await fs.readFile(file, "utf8"));
    const url = new URL(info.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || typeof info.token !== "string")
      return null;
    if (Number.isInteger(info.pid)) {
      try {
        process.kill(info.pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") return null;
      }
    }
    return info;
  } catch {
    return null;
  }
}

export async function removeBridgeFile(file, token) {
  try {
    const info = JSON.parse(await fs.readFile(file, "utf8"));
    if (!token || info.token === token) await fs.unlink(file);
  } catch {}
}

/** Connect an MCP client to the bridge; rejects within timeoutMs when it is not reachable. */
export async function connectBridge(
  { url, token },
  { timeoutMs = 2000, name = "verynize-stdio-proxy" } = {},
) {
  const client = new Client({ name, version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  let timer;
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Bridge did not answer")), timeoutMs);
      }),
    ]);
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
