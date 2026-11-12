// Exercise the deployable static assets through Cloudflare's production routing and headers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { freePort, startProcess } from "./helpers/web-app.mjs";

execFileSync(process.execPath, ["node_modules/vite-plus/bin/vp", "build"], { stdio: "pipe" });
const port = await freePort();
const origin = `http://localhost:${port}`;
const server = await startProcess(
  process.execPath,
  ["node_modules/vite-plus/bin/vp", "preview", "--port", String(port), "--strictPort"],
  { ready: origin + "/" },
);
try {
  for (const [route, type] of [
    ["/favicon.ico", /^image\/(x-icon|vnd.microsoft.icon)/],
    ["/favicon.svg", /^image\/svg\+xml/],
    ["/apple-touch-icon.png", /^image\/png/],
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type"), type, route);
    assert.equal(response.headers.get("cache-control"), "public, max-age=86400", route);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (route.endsWith(".ico")) {
      assert.equal(bytes.readUInt16LE(2), 1, "ICO type");
      assert.equal(bytes.readUInt16LE(4), 2, "two ICO sizes");
      assert.deepEqual(
        [bytes[6], bytes[22]].sort((a, b) => a - b),
        [16, 32],
      );
    }
    if (route.endsWith(".png")) {
      assert.equal(bytes.readUInt32BE(16), 180);
      assert.equal(bytes.readUInt32BE(20), 180);
    }
  }
  const shell = await fetch(origin + "/");
  assert.doesNotMatch(shell.headers.get("cache-control") || "", /no-transform/);
  const html = await shell.text();
  assert.match(html, /href="\/favicon.svg"/);
  assert.match(html, /href="\/apple-touch-icon.png"/);
  console.log("PASS built web icons: 3 static images, dimensions, cache headers and shell links");
} finally {
  await server.stop();
}
