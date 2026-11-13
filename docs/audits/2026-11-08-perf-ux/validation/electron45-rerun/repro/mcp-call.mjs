// usage: node call.mjs <tool|--list> [jsonArgs]
import fs from "node:fs";
import os from "node:os";
const info = JSON.parse(
  fs.readFileSync(os.homedir() + "/Library/Application Support/Verynize/mcp.json", "utf8"),
);
let sid = null,
  id = 0;
async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: "Bearer " + info.token,
  };
  if (sid) headers["mcp-session-id"] = sid;
  const body = { jsonrpc: "2.0", method, params };
  if (!method.startsWith("notifications/")) body.id = ++id;
  const r = await fetch(info.url, { method: "POST", headers, body: JSON.stringify(body) });
  sid = r.headers.get("mcp-session-id") || sid;
  const t = await r.text();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return JSON.parse(
      t
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .pop()
        .slice(5),
    );
  }
}
await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "audit", version: "1" },
});
await rpc("notifications/initialized", {});
const [tool, args] = process.argv.slice(2);
if (tool === "--list") {
  const r = await rpc("tools/list", {});
  console.log(r.result.tools.map((t) => t.name).join("\n"));
} else {
  const t0 = Date.now();
  const r = await rpc("tools/call", { name: tool, arguments: JSON.parse(args || "{}") });
  const out = { ms: Date.now() - t0, isError: r.result?.isError, error: r.error };
  out.content = (r.result?.content || []).map((c) =>
    c.type === "image"
      ? (fs.writeFileSync(process.env.OUT || "shot.png", Buffer.from(c.data, "base64")),
        { type: "image", bytes: (c.data.length * 3) / 4, saved: process.env.OUT || "shot.png" })
      : { type: c.type, text: (c.text || "").slice(0, 1500) },
  );
  console.log(JSON.stringify(out, null, 1));
}
