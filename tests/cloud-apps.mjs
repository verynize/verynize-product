// Published running apps: a real project build (its own npm script) is collected, uploaded to
// local workerd through the HTTP API and served with versioning, rollback and unpublish. File bytes are stored in the asset bucket (R2).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Miniflare, cloudOptions, signIn } from "./cloud-harness.mjs";

const require = createRequire(import.meta.url);
const publisher = require("../desktop/app-publish.cjs");
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-apps-"));
const options = await cloudOptions(path.join(dir, "state"));
let mf = new Miniflare(options);
/** Keys of the published app files in the asset bucket (R2 on workerd, the blob directory on Node). */
async function appObjects() {
  if (typeof mf.getR2Bucket === "function") {
    const bucket = await mf.getR2Bucket("ASSETS_BUCKET");
    return (await bucket.list({ prefix: "apps/" })).objects.map((object) => object.key).sort();
  }
  const root = path.join(dir, "state", "blobs", "verynize-assets");
  const found = [];
  const walk = async (folder) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (!/\.(meta\.json|tmp)$/.test(entry.name))
        found.push(path.relative(root, file).split(path.sep).join("/"));
    }
  };
  await walk(path.join(root, "apps"));
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201a5f1b6f40000000049454e44ae426082",
  "hex",
);

async function writeProject(root, label, { fail = false } = {}) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "Demo Site", private: true, scripts: { build: "node build.mjs" } }),
  );
  await fs.writeFile(
    path.join(root, "build.mjs"),
    `import fs from 'node:fs';
${fail ? "console.error('type error in src/app.ts'); process.exit(2);" : ""}
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/assets', { recursive: true }); fs.mkdirSync('dist/about', { recursive: true });
fs.writeFileSync('dist/index.html', '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="assets/style.css"></head><body><h1 id="label">${label}</h1><script type="module" src="assets/app.js"></script></body></html>');
fs.writeFileSync('dist/about/index.html', '<!doctype html><html><head></head><body>About ${label}</body></html>');
fs.writeFileSync('dist/assets/app.js', 'document.body.dataset.ready = "${label}";');
fs.writeFileSync('dist/assets/style.css', 'h1 { color: rebeccapurple; }');
fs.writeFileSync('dist/data.json', JSON.stringify({ label: '${label}' }));
fs.writeFileSync('dist/logo.png', Buffer.from('${png.toString("hex")}', 'hex'));
`,
  );
}

try {
  let origin = (await mf.ready).origin;
  const alice = await signIn(origin, "alice@example.test");
  const bob = await signIn(origin, "bob@example.test");
  const project = path.join(dir, "project");
  await writeProject(project, "Version one");

  const detected = await publisher.detect(project);
  assert.equal(detected.name, "demo-site");
  assert.deepEqual(detected.command, ["npm", "run", "build"]);
  const viteRoot = path.join(dir, "vite-project");
  await fs.mkdir(viteRoot);
  await fs.writeFile(
    path.join(viteRoot, "package.json"),
    JSON.stringify({ name: "vite-demo", scripts: { build: "tsc && vite build" } }),
  );
  await fs.writeFile(path.join(viteRoot, "pnpm-lock.yaml"), "");
  assert.deepEqual(
    (await publisher.detect(viteRoot)).command,
    ["pnpm", "run", "build", "--", "--base=./"],
    "Vite builds get a relative base",
  );

  await assert.rejects(
    publisher.publish({ root: project, server: origin, session: "vs_" + "0".repeat(64) }),
    /Sign in first|401/,
  );
  const first = await publisher.publish({ root: project, server: origin, session: alice.session });
  assert.equal(first.built, true);
  assert.equal(first.version, 1);
  assert.equal(first.files, 6);
  const handle = alice.account.handle;
  assert.equal(first.url, `${origin}/apps/${handle}/demo-site/`);
  assert.equal(
    await fs
      .readFile(path.join(project, "dist/index.html"), "utf8")
      .then((html) => html.includes("Version one")),
    true,
    "the project build script really ran",
  );

  const get = (route, init) => fetch(origin + route, { redirect: "manual", ...init });
  let response = await get(`/apps/${handle}/demo-site/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(response.headers.get("content-security-policy"), /^sandbox allow-scripts/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-verynize-app-version"), "1");
  let html = await response.text();
  assert.match(html, new RegExp(`<head><base href="/apps/${handle}/demo-site/">`));
  assert.match(html, /Version one/);
  const types = {
    "assets/app.js": "text/javascript; charset=utf-8",
    "assets/style.css": "text/css; charset=utf-8",
    "data.json": "application/json; charset=utf-8",
    "logo.png": "image/png",
  };
  for (const [file, type] of Object.entries(types)) {
    response = await get(`/apps/${handle}/demo-site/${file}`);
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get("content-type"), type, file);
  }
  assert.deepEqual(
    Buffer.from(await (await get(`/apps/${handle}/demo-site/logo.png`)).arrayBuffer()),
    png,
    "binary assets round-trip byte for byte",
  );
  assert.match(await (await get(`/apps/${handle}/demo-site/about/`)).text(), /About Version one/);
  assert.match(
    await (await get(`/apps/${handle}/demo-site/settings/profile`)).text(),
    /<h1 id="label">Version one/,
    "client-side routes fall back to index.html",
  );
  assert.equal((await get(`/apps/${handle}/demo-site/missing.png`)).status, 404);
  response = await get(`/apps/${handle}/demo-site`);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), `${origin}/apps/${handle}/demo-site/`);
  const etag = (await get(`/apps/${handle}/demo-site/assets/app.js`)).headers.get("etag");
  assert.equal(
    (await get(`/apps/${handle}/demo-site/assets/app.js`, { headers: { "if-none-match": etag } }))
      .status,
    304,
  );

  let profile = await (await get(`/api/profiles/${handle}`)).json();
  assert.deepEqual(
    profile.publications.map((item) => [item.kind, item.path]),
    [["app", `/apps/${handle}/demo-site/`]],
  );
  assert.match(
    await (await get(`/u/${handle}`)).text(),
    new RegExp(`href="/apps/${handle}/demo-site/"`),
  );

  // A second build becomes the live version; the first stays reachable at its pinned URL.
  await writeProject(project, "Version two");
  const second = await publisher.publish({
    root: project,
    server: origin,
    session: alice.session,
    note: "second",
  });
  assert.equal(second.version, 2);
  assert.equal(second.versionUrl, `${origin}/apps/${handle}/demo-site@2/`);
  assert.match(await (await get(`/apps/${handle}/demo-site/`)).text(), /Version two/);
  response = await get(`/apps/${handle}/demo-site@1/`);
  assert.match(response.headers.get("cache-control"), /immutable/);
  html = await response.text();
  assert.match(html, /Version one/);
  assert.match(html, new RegExp(`<base href="/apps/${handle}/demo-site@1/">`));
  const appId = second.app.id;
  const api = (route, method = "GET", body, session = alice.session) =>
    fetch(origin + route, {
      method,
      headers: { "x-verynize-session": session, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const listing = await (await api(`/api/apps/${appId}`)).json();
  assert.deepEqual(
    listing.versions.map((v) => [v.version, v.files]),
    [
      [2, 6],
      [1, 6],
    ],
  );
  assert.equal(listing.app.activeVersion, 2);

  // File bytes live in the asset bucket, one object per distinct file shared by both versions.
  const stored = await appObjects();
  assert.ok(stored.length >= 6 && stored.length < 12, stored.join(", "));
  assert.ok(
    stored.every((key) => /^apps\/[^/]+\/[0-9a-f]{64}$/.test(key)),
    stored.join(", "),
  );

  // Rollback, then deleting the live version is refused while the old one can go.
  assert.equal((await api(`/api/apps/${appId}/activate`, "POST", { version: 1 })).status, 200);
  assert.match(await (await get(`/apps/${handle}/demo-site/`)).text(), /Version one/);
  assert.equal((await api(`/api/apps/${appId}/versions/1`, "DELETE")).status, 409);
  assert.equal((await api(`/api/apps/${appId}/versions/2`, "DELETE")).status, 200);
  // Objects only version 2 used are deleted; version 1's stay.
  const remaining = await appObjects();
  assert.ok(remaining.length < stored.length && remaining.length >= 6, remaining.join(", "));
  assert.ok(remaining.every((key) => stored.includes(key)));
  assert.equal((await get(`/apps/${handle}/demo-site@2/`)).status, 404);
  assert.equal((await api(`/api/apps/${appId}/activate`, "POST", { version: 2 })).status, 404);

  // Other accounts cannot see or change the app; uploads validate paths and manifests.
  assert.equal((await api(`/api/apps/${appId}`, "GET", null, bob.session)).status, 404);
  assert.equal((await api(`/api/apps/${appId}/versions`, "POST", {}, bob.session)).status, 404);
  const { version: draft } = await (await api(`/api/apps/${appId}/versions`, "POST", {})).json();
  for (const bad of ["..%2Fescape.js", "a%2F..%2F..%2Fb.js", "%2Fetc%2Fpasswd"]) {
    response = await fetch(`${origin}/api/apps/${appId}/versions/${draft}/files/${bad}`, {
      method: "PUT",
      headers: { "x-verynize-session": alice.session },
      body: "x",
    });
    assert.equal(response.status, 400, bad);
  }
  await fetch(`${origin}/api/apps/${appId}/versions/${draft}/files/index.html`, {
    method: "PUT",
    headers: { "x-verynize-session": alice.session },
    body: "<p>tampered</p>",
  });
  response = await api(`/api/apps/${appId}/versions/${draft}/finalize`, "POST", {
    files: [{ path: "index.html", size: 3, sha256: "0".repeat(64) }],
  });
  assert.equal(response.status, 409, "manifest mismatch is rejected");
  assert.equal(
    (await get(`/apps/${handle}/demo-site@${draft}/`)).status,
    404,
    "unsealed versions are never served",
  );

  // Failing builds surface their output and publish nothing.
  const broken = path.join(dir, "broken");
  await writeProject(broken, "Broken", { fail: true });
  await assert.rejects(
    publisher.publish({ root: broken, server: origin, session: alice.session, name: "broken" }),
    /Build failed \(exit 2\).*type error/,
  );
  assert.equal((await get(`/apps/${handle}/broken/`)).status, 404);

  // Published builds survive a runtime restart.
  await mf.dispose();
  mf = new Miniflare(options);
  origin = (await mf.ready).origin;
  assert.match(await (await fetch(`${origin}/apps/${handle}/demo-site/`)).text(), /Version one/);

  // Unpublish removes the app from its URL and from the public profile.
  assert.equal(
    (
      await fetch(`${origin}/api/apps/${appId}/publish`, {
        method: "DELETE",
        headers: { "x-verynize-session": alice.session },
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${origin}/apps/${handle}/demo-site/`)).status, 404);
  profile = await (await fetch(`${origin}/api/profiles/${handle}`)).json();
  assert.deepEqual(profile.publications, []);
  console.log(
    "PASS app publishing: real project build, upload, content types, base injection, SPA fallback, ETag, versions, pinned URLs, rollback, ownership, path/manifest validation, failed builds, restart persistence, unpublish",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
