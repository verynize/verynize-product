// Strict worker HTML keeps its CSP and opts out of automatic beacon injection.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-page-icons-"));
let mf;
try {
  mf = new Miniflare(await cloudOptions(dir));
  for (const [route, status] of [
    ["/account/verified", 200],
    ["/account/verified?error=INVALID_TOKEN", 400],
    ["/account/reset-password?token=test", 200],
    ["/account/reset-password?error=INVALID_TOKEN", 400],
    ["/passkey", 200],
    ["/u/missing-creator", 404],
    ["/apps/missing-app", 404],
  ]) {
    const response = await mf.dispatchFetch("http://local" + route);
    assert.equal(response.status, status, route);
    assert.equal(response.headers.get("cache-control"), "no-store, no-transform", route);
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/, route);
    assert.match(csp, /img-src 'self'/, route);
    assert.doesNotMatch(csp, /cloudflareinsights|script-src[^;]*https:/, route);
    const html = await response.text();
    assert.match(html, /rel="icon" href="\/favicon.svg" type="image\/svg\+xml"/, route);
    assert.match(html, /rel="icon" href="\/favicon.ico"/, route);
    assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon.png"/, route);
  }
  console.log("PASS worker page icons: 7 routes, strict CSP and no-transform");
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
