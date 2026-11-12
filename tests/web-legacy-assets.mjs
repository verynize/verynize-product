// Production asset contract, including real Cloudflare headers and Chromium's HTTP cache.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLegacyAssets } from "../web-start/build/legacy-assets.mjs";
import { parseLegacyShell, STATIC_HEADERS } from "../web-start/build/legacy-web.mjs";
import { freePort, launchBrowser, startProcess } from "./helpers/web-app.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-assets-"));
try {
  fs.mkdirSync(path.join(fixture, "css"));
  fs.writeFileSync(path.join(fixture, "font.woff2"), "font one");
  fs.writeFileSync(path.join(fixture, "app.js"), "var shared = 1;");
  fs.writeFileSync(
    path.join(fixture, "css/style.css"),
    `a{src:url('../font.woff2?v=1#font');background:url(data:image/png;base64,AA==);mask:url(#mask);background-image:url(missing.png)}`,
  );
  const shell = { styles: [{ href: "/css/style.css" }], scripts: [{ attrs: { src: "/app.js" } }] };
  const before = buildLegacyAssets(fixture, shell);
  const css = before.files.get(before.assetUrls["/css/style.css"].slice(1)).toString();
  assert.match(css, /\/assets\/legacy\/font-[a-f0-9]{16}\.woff2\?v=1#font/);
  assert.match(css, /data:image\/png;base64,AA==/);
  assert.match(css, /url\("#mask"\)/);
  assert.match(css, /url\("\/css\/missing.png"\)/);
  fs.writeFileSync(path.join(fixture, "font.woff2"), "font two");
  const after = buildLegacyAssets(fixture, shell);
  assert.notEqual(before.assetUrls["/css/style.css"], after.assetUrls["/css/style.css"]);
  assert.equal(before.assetUrls["/app.js"], after.assetUrls["/app.js"]);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

if (!process.argv.includes("--prebuilt"))
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
const port = await freePort();
const origin = `http://localhost:${port}`;
const server = await startProcess(
  process.execPath,
  ["node_modules/vite-plus/bin/vp", "preview", "--port", String(port), "--strictPort"],
  {
    cwd: root,
    env: process.env,
    ready: origin + "/",
  },
);
let browser;
try {
  const manifestResponse = await fetch(origin + "/legacy-assets.json");
  assert.equal(manifestResponse.status, 200);
  assert.doesNotMatch(manifestResponse.headers.get("cache-control") ?? "", /immutable/);
  const manifest = await manifestResponse.json();
  const shell = parseLegacyShell(fs.readFileSync(path.join(root, "web/index.html"), "utf8"));
  const references = [
    ...shell.styles.map((s) => s.href),
    ...shell.scripts.map((s) => s.attrs.src),
  ].filter((ref) => ref && !/dist\/(ui|telemetry)\.js/.test(ref));
  for (const reference of references) assert.ok(manifest[reference], reference);
  assert.match(
    STATIC_HEADERS,
    /\/assets\/legacy\/:file\n  Cache-Control: public, max-age=31536000, immutable/,
  );
  const urls = [...new Set(Object.values(manifest))];
  for (const url of urls) {
    assert.match(url, /^\/assets\/legacy\/[^/]+-[a-f0-9]{16}\.[\w]+$/);
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable", url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    assert.ok(url.includes(`-${hash}.`), `hash matches served bytes: ${url}`);
  }
  for (const reference of references) {
    const original = await fetch(origin + reference);
    assert.equal(original.status, 200, reference);
    assert.doesNotMatch(original.headers.get("cache-control") ?? "", /immutable/);
    if (reference.endsWith(".js")) {
      const copy = await fetch(origin + manifest[reference]);
      assert.equal(
        await copy.text(),
        await original.text(),
        `classic script unchanged: ${reference}`,
      );
    }
  }
  for (const route of ["/", "/editor", "/settings/preferences"])
    assert.doesNotMatch(
      (await fetch(origin + route)).headers.get("cache-control") ?? "",
      /immutable/,
      route,
    );

  browser = await launchBrowser();
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  let revalidations = 0;
  cdp.on("Network.responseReceivedExtraInfo", (event) => {
    if (event.statusCode === 304) revalidations++;
  });
  // Navigate away and back in the same browser context, like a repeat visit. Fetch the complete
  // manifest on each visit, including scripts a future home/editor subset may not boot yet.
  const visit = async () => {
    await page.goto(origin + "/");
    return page.evaluate(async (urls) => {
      performance.clearResourceTimings();
      await Promise.all(
        urls.map(async (url) => {
          const response = await fetch(url);
          await response.arrayBuffer();
        }),
      );
      return performance
        .getEntriesByType("resource")
        .filter(
          (entry) => entry.initiatorType === "fetch" && urls.includes(new URL(entry.name).pathname),
        )
        .map((entry) => ({ url: entry.name, bytes: entry.transferSize }));
    }, urls);
  };
  await visit();
  await page.goto("about:blank");
  revalidations = 0;
  const warm = await visit();
  assert.equal(warm.length, urls.length);
  assert.equal(warm.filter((entry) => entry.bytes > 0).length, 0, JSON.stringify(warm));
  assert.equal(revalidations, 0, "repeat visit has no 304 responses");
  console.log(
    `PASS legacy assets: ${references.length} boot URLs, ${urls.length} hashed assets; warm visit 0 transferred bytes, 0 revalidations`,
  );
} catch (error) {
  console.error(server.output());
  throw error;
} finally {
  await browser?.close();
  await server.stop();
}
