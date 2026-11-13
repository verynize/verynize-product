// /api/ai/* belongs to the cloud backend on every target (docs/ai-runtime.md), never to Start:
// - Cloudflare: the deployable Worker bundle (entry web-start/src/server.cloudflare.ts) in local
//   workerd answers /api/ai/* from cloud/worker.js while /editor is rendered by Start.
// - Node: web-start/node/server.mjs (the Node build of the web app) proxies /api/ai/* to a real
//   backend (server/node.mjs's runtime) and streams the run's SSE without buffering.
// - Vercel: vercel.json rewrites /api/ai/* to the backend function, whose handler restores the
//   original path and query (the live Vercel runtime runs tests/cloud-ai.mjs: test:cloud:vercel).
// The model provider is the local fake (tests/helpers/fake-openrouter.mjs).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare as Workerd } from "miniflare";
import { cloudOptions, passwordUser } from "./cloud-harness.mjs";
import { CURRENT_WORKER, NodeCloud } from "./helpers/node-cloud.mjs";
import { startFakeOpenRouter } from "./helpers/fake-openrouter.mjs";
import { isWorkerPath } from "../web-start/worker-paths.mjs";
import { restorePath, REWRITTEN_PATH } from "../cloud/platform/vercel/handler.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const AI_PATHS = [
  "/api/ai/config",
  "/api/ai/runs",
  "/api/ai/runs/0b7f2a4e-3c1d-4e5f-8a9b-0c1d2e3f4a5b/events",
  "/api/ai/runs/0b7f2a4e-3c1d-4e5f-8a9b-0c1d2e3f4a5b/cancel",
  "/api/ai/runs/0b7f2a4e-3c1d-4e5f-8a9b-0c1d2e3f4a5b/approvals",
  "/api/ai/credentials",
  "/api/ai/credentials/openrouter",
  "/api/ai/credentials/openrouter/oauth/start",
];
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "verynize-ai-routing-"));
const fake = await startFakeOpenRouter({
  steps: [[{ text: "first " }, { delay: 1200 }, { text: "second" }]],
  default: [[{ text: "ok" }]],
});
const aiEnv = {
  VERYNIZE_AI_SERVER_KEY: { type: "text", value: "1" },
  OPENROUTER_API_KEY: { type: "text", value: "routing-test-key" },
  OPENROUTER_BASE_URL: { type: "text", value: fake.baseUrl },
  VERYNIZE_AI_MODELS: { type: "text", value: "fake/model" },
};

// Shared dispatch rule (Cloudflare entry and Node web server).
for (const route of AI_PATHS) assert.ok(isWorkerPath(route), `${route} is a backend path`);

try {
  await cloudflare();
  await vercel();
  await node();
  console.log("PASS /api/ai/* reaches the backend on Cloudflare, Node and Vercel");
} finally {
  await fake.close();
  await fsp.rm(temp, { recursive: true, force: true });
}

async function cloudflare() {
  // cloudOptions builds and runs the same bundle `cf deploy --prebuilt` uploads.
  const options = await cloudOptions(path.join(temp, "workerd"));
  const config = options.workers[0].config;
  config.env = { ...config.env, ...aiEnv };
  const mf = new Workerd(options);
  try {
    for (const route of AI_PATHS) {
      const response = await mf.dispatchFetch("http://local" + route);
      assert.equal(response.status, 401, route);
      assert.match(response.headers.get("content-type") || "", /application\/json/, route);
      assert.deepEqual(await response.json(), { error: "Sign in first" }, route);
    }
    const token = await passwordUser("http://local", "cf@example.test", "Cf", (u, i) =>
      mf.dispatchFetch(u, i),
    );
    const configured = await mf.dispatchFetch("http://local/api/ai/config", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal((await configured.json()).enabled, true);
    // Start still renders the app pages of the same Worker.
    const editor = await mf.dispatchFetch("http://local/editor");
    assert.equal(editor.status, 200);
    assert.match(await editor.text(), /<html/i);
  } finally {
    await mf.dispose();
  }
  console.log("PASS Cloudflare: /api/ai/* answered by cloud/worker.js, /editor by Start");
}

async function vercel() {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  // vercel.json source patterns: `:name*` matches the rest of the path, `(.*)` anything.
  const compile = (source) =>
    new RegExp(
      "^" +
        source
          .replace(/[.]/g, "\\.")
          .replace(/:(\w+)\*/g, "(?<$1>.*)")
          .replace(/\(\.\*\)/g, "(.*)") +
        "$",
    );
  for (const route of AI_PATHS) {
    const rule = config.rewrites.find((r) => compile(r.source).test(route));
    assert.ok(rule, route);
    assert.equal(rule.destination, "/api/server?__vz_path=/api/:path*", route);
    const rest = compile(rule.source).exec(route).groups.path;
    const target = new URL(
      rule.destination.replace(":path*", rest) + "&after=3&path=" + encodeURIComponent(rest),
      "https://example.vercel.app",
    );
    assert.equal(target.pathname, "/api/server");
    restorePath(target, target.searchParams.get(REWRITTEN_PATH));
    assert.equal(target.pathname, route);
    assert.equal(target.search, "?after=3");
  }
  assert.ok(config.functions["api/server.mjs"].maxDuration >= 60, "runs need a long function");
  console.log("PASS Vercel: vercel.json sends /api/ai/* to api/server.mjs with the original path");
}

async function node() {
  if (!process.env.TEST_WEB_NODE_BUILT)
    execFileSync(
      process.execPath,
      ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"],
      {
        cwd: root,
        stdio: "pipe",
      },
    );
  const { createWebServer } = await import("../web-start/node/server.mjs");
  const options = await cloudOptionsForNode(path.join(temp, "node"));
  const backend = new NodeCloud(options);
  const backendOrigin = (await backend.ready).origin;
  const web = await createWebServer({
    dist: path.join(root, "dist/web-node"),
    backend: backendOrigin,
  });
  await new Promise((resolve) => web.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${web.address().port}`;
  try {
    const anonymous = await fetch(origin + "/api/ai/config");
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: "Sign in first" });
    const token = await passwordUser(origin, "node@example.test", "Node");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const room = await (
      await fetch(origin + "/api/rooms", {
        method: "POST",
        headers,
        body: JSON.stringify({
          document: {
            version: 2,
            name: "R",
            pages: [{ id: "p", name: "P", nodes: [] }],
            tokens: {},
          },
        }),
      })
    ).json();
    const started = Date.now();
    const response = await fetch(origin + "/api/ai/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        chatId: "routing",
        roomId: room.id,
        prompt: "[scenario:steps]",
        idempotencyKey: "routing-key-1",
      }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/event-stream/);
    // The first events arrive while the model is still pausing: the proxy does not buffer.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let firstAt = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!firstAt && text.includes('"type":"session"')) firstAt = Date.now();
    }
    const events = text
      .split("\n\n")
      .filter((block) => block.startsWith("data: "))
      .map((block) => JSON.parse(block.slice(6)));
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).code, "ok");
    assert.ok(firstAt > 0 && Date.now() - firstAt >= 1000, "streamed before the run finished");
    assert.ok(Date.now() - started >= 1200);
  } finally {
    web.closeAllConnections?.();
    await new Promise((resolve) => web.close(resolve));
    await backend.dispose();
  }
  console.log("PASS Node: web-start/node/server.mjs streams /api/ai/* from the backend unbuffered");
}

/** The cloud test configuration on the Node runtime, with the model API runtime enabled. */
async function cloudOptionsForNode(persistence) {
  const options = await cloudOptions(persistence);
  const config = options.workers[0].config;
  // NodeCloud runs cloud/worker.js itself instead of the workerd bundle.
  config.manifest = CURRENT_WORKER;
  config.env = { ...config.env, ...aiEnv };
  return options;
}
