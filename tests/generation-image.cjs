// Photographic image providers end to end in Electron: provider settings with the API key stored via
// safeStorage (never returned, logged, persisted in clear text or kept in renderer storage), generation
// through a local OpenAI-compatible fixture server and a generic HTTP fixture that return real PNG
// bytes, insertion as an image layer through the chat path (live MCP generate_image), relaunch
// persistence and redacted provider errors.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { png } = require("./fixtures/png.cjs");

const KEY = "sk-verynize-fixture-7f3a9c21d4e8b6";
const WRONG = "sk-wrong-fixture-key-55aa11";

(async () => {
  const photo = png(96, 64, (x, y) => [x * 2, 80 + y, 200 - x]);
  const generic = png(40, 30, [20, 160, 90]);
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ url: req.url, auth: req.headers.authorization || "", body });
      if (req.url.startsWith("/models/")) {
        assert.equal(req.headers["x-goog-api-key"], KEY);
        assert.equal(req.headers.authorization, undefined);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { mimeType: "image/png", data: photo.toString("base64") } },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/v1/images/generations") {
        res.setHeader("content-type", "application/json");
        if (req.headers.authorization !== "Bearer " + KEY) {
          res.statusCode = 401;
          res.end(
            JSON.stringify({
              error: { message: "Invalid key: " + (req.headers.authorization || "").slice(7) },
            }),
          );
          return;
        }
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: photo.toString("base64") }] }));
        return;
      }
      if (req.url === "/slow") {
        setTimeout(() => {
          res.setHeader("content-type", "image/png");
          res.end(generic);
        }, 300);
        return;
      }
      if (req.url === "/generate") {
        res.setHeader("content-type", "image/png");
        res.end(generic);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "generation-image-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_TEST_IMAGE_GOOGLE_URL = base;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  delete env.VERYNIZE_DISABLE_MCP;
  let logs = "";
  let mcpCalls = 0;
  const launch = async () => {
    const app = await _electron.launch({
      env,
      args: [".", `--user-data-dir=${dir}`],
      timeout: 20000,
    });
    app.process().stdout.on("data", (d) => {
      logs += d;
    });
    app.process().stderr.on("data", (d) => {
      logs += d;
    });
    app.on("console", (m) => {
      logs += m.text();
    });
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    page.on("console", (m) => {
      logs += m.text();
    });
    await page.waitForFunction(() => !!window.desktop?.imageProvider);
    return { app, page };
  };
  // Chat agents generate through the live MCP bridge; each call counts toward its hourly limit.
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const generateFromChat = async (prompt) => {
    let info;
    for (let i = 0; i < 100 && !info; i++)
      info = await fs
        .readFile(path.join(dir, "mcp.json"), "utf8")
        .then(JSON.parse)
        .catch(() => new Promise((resolve) => setTimeout(resolve, 100)));
    assert.ok(info, "MCP bridge started");
    const client = new Client({ name: "generation-image-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(info.url), {
        requestInit: { headers: { Authorization: `Bearer ${info.token}` } },
      }),
    );
    try {
      mcpCalls++;
      const result = await client.callTool({ name: "generate_image", arguments: { prompt } });
      return { ok: !result.isError, text: result.content?.[0]?.text || "" };
    } finally {
      await client.close().catch(() => {});
    }
  };
  const imageNodes = (page) =>
    page.evaluate(() =>
      window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .filter((n) => n.type === "image"),
    );
  let { app, page } = await launch();
  try {
    assert.equal(
      (await page.evaluate(() => window.desktop.imageProvider.get())).secureStorage,
      null,
    );
    await fs.writeFile(path.join(dir, "image-provider.json"), "{broken");
    const recovered = await page.evaluate(() => window.desktop.imageProvider.get());
    assert.equal(
      recovered.defaultProvider,
      recovered.providers.find((provider) => provider.id === "codex_plan").available
        ? "codex_plan"
        : "nano_banana_lite",
    );
    assert.equal(await fs.readFile(path.join(dir, "image-provider.json.bak"), "utf8"), "{broken");
    assert.equal(
      await page.locator("#generate-art, #generate-dialog").count(),
      0,
      "images are generated from chat, not a dialog",
    );
    // Plain http to a non-loopback host is refused (the key would travel in clear text).
    const refused = await page.evaluate(() =>
      window.desktop.imageProvider
        .set({ provider: "openai", baseURL: "http://images.example.com/v1" })
        .catch((e) => e.message),
    );
    assert.match(refused, /https/);

    await page.evaluate(
      ({ url, key }) =>
        window.desktop.imageProvider.set({
          vendor: "custom",
          defaultProvider: "custom",
          custom: {
            provider: "openai",
            baseURL: url,
            model: "fixture-photo-model",
            size: "1024x1024",
          },
          apiKey: key,
        }),
      { url: base + "/v1", key: KEY },
    );
    const first = await generateFromChat("A foggy harbour at sunrise, 35mm photo");
    assert.ok(first.ok, first.text);
    const sent = requests.find((r) => r.url === "/v1/images/generations");
    assert.equal(sent.auth, "Bearer " + KEY);
    assert.deepEqual(JSON.parse(sent.body), {
      model: "fixture-photo-model",
      prompt: "A foggy harbour at sunrise, 35mm photo",
      n: 1,
      size: "1024x1024",
    });
    let images = await imageNodes(page);
    assert.equal(images.length, 1);
    assert.equal(images[0].w, 96);
    assert.equal(images[0].h, 64);
    assert.match(images[0].src, /^data:image\//);
    assert.equal(
      (await page
        .locator(`#canvas [data-id="${images[0].id}"] img, #canvas [data-id="${images[0].id}"]`)
        .count()) > 0,
      true,
    );

    // The key never comes back to the renderer and is not stored in clear text anywhere.
    const settings = await page.evaluate(() => window.desktop.imageProvider.get());
    assert.equal(settings.hasKey, true);
    assert.equal(settings.model, "fixture-photo-model");
    assert.doesNotMatch(JSON.stringify(settings), new RegExp(KEY));
    const file = await fs.readFile(path.join(dir, "image-provider.json"), "utf8");
    assert.doesNotMatch(file, new RegExp(KEY));
    const secure = settings.secureStorage;
    if (secure) {
      assert.equal(settings.keyStorage, "keychain");
      assert.ok(JSON.parse(file).keys.custom.length > 20, "ciphertext stored");
    } else assert.equal(settings.keyStorage, "session");
    const rendererState = await page.evaluate(
      () =>
        JSON.stringify(localStorage) +
        JSON.stringify(sessionStorage) +
        JSON.stringify(window.design.getDocument()),
    );
    assert.doesNotMatch(rendererState, new RegExp(KEY));

    // Provider errors are surfaced without the key.
    await page.evaluate((k) => window.desktop.imageProvider.set({ apiKey: k }), WRONG);
    const failed = await generateFromChat("A foggy harbour at sunrise, 35mm photo");
    assert.equal(failed.ok, false);
    const errorText = failed.text;
    assert.match(errorText, /401/);
    assert.match(errorText, /check the API key/);
    assert.doesNotMatch(errorText, new RegExp(WRONG));
    await page.evaluate((k) => window.desktop.imageProvider.set({ apiKey: k }), KEY);
    await app.close();
    await fs.rm(path.join(dir, "mcp.json"), { force: true });
    mcpCalls = 0;

    // A legacy disk record migrates on relaunch, preserving its custom configuration.
    const stored = JSON.parse(await fs.readFile(path.join(dir, "image-provider.json"), "utf8"));
    await fs.writeFile(
      path.join(dir, "image-provider.json"),
      JSON.stringify({
        ...stored.custom,
        ...(stored.keys.custom ? { key: stored.keys.custom } : {}),
      }),
    );
    // Relaunch: the saved provider and (safeStorage) key are reused without re-entering them.
    ({ app, page } = await launch());
    if (secure) {
      const reused = await page.evaluate(() => window.desktop.imageProvider.get());
      assert.equal(reused.custom.baseURL, base + "/v1");
      assert.equal(reused.keys.custom.hasKey, true);
      const second = await generateFromChat("Second photo");
      assert.ok(second.ok, second.text);
      assert.equal(requests.at(-1).auth, "Bearer " + KEY);
    }
    const migrated = await page.evaluate(() => window.desktop.imageProvider.get());
    assert.equal(migrated.defaultProvider, "custom");
    assert.equal(
      JSON.parse(await fs.readFile(path.join(dir, "image-provider.json"), "utf8")).version,
      2,
    );
    await page.evaluate(
      (k) =>
        window.desktop.imageProvider.set({
          vendor: "google",
          apiKey: k,
          defaultProvider: "nano_banana_lite",
        }),
      KEY,
    );
    const generated = await page.evaluate(() =>
      window.desktop.imageProvider.generate({ prompt: "Google default" }),
    );
    assert.equal(generated.model, "gemini-3.1-flash-lite-image");
    assert.match(requests.at(-1).url, /gemini-3.1-flash-lite-image:generateContent/);
    const override = await page.evaluate(() =>
      window.desktop.imageProvider.generate({ prompt: "Override", provider: "nano_banana" }),
    );
    assert.equal(override.model, "gemini-nano-banana-2.1");
    assert.equal(
      (await page.evaluate(() => window.desktop.imageProvider.get())).defaultProvider,
      "nano_banana_lite",
    );
    await page.evaluate(() =>
      window.desktop.imageProvider.set({ vendor: "google", clearKey: true }),
    );
    // Generic HTTP provider returning raw PNG bytes; removing the key stops sending it.
    await page.evaluate(
      (url) =>
        window.desktop.imageProvider.set({
          provider: "http",
          baseURL: url,
          model: "local-diffusion",
          size: "1024x1536",
          clearKey: true,
        }),
      base + "/generate",
    );
    assert.equal((await page.evaluate(() => window.desktop.imageProvider.get())).hasKey, false);
    assert.doesNotMatch(await fs.readFile(path.join(dir, "image-provider.json"), "utf8"), /"key"/);
    const mug = await generateFromChat("Studio product shot of a green ceramic mug");
    assert.ok(mug.ok, mug.text);
    const last = requests.at(-1);
    assert.equal(last.url, "/generate");
    assert.equal(last.auth, "");
    assert.deepEqual(JSON.parse(last.body), {
      prompt: "Studio product shot of a green ceramic mug",
      model: "local-diffusion",
      width: 1024,
      height: 1536,
    });
    images = await imageNodes(page);
    assert.ok(images.some((n) => /^data:image\//.test(n.src) && n.w === 40 && n.h === 30));
    const service = await app.evaluate(
      async ({ app }, { modulePath, used }) => {
        const { imageGenerator } = process.mainModule.require(modulePath);
        const saved = await imageGenerator.get();
        await imageGenerator.set({
          custom: { ...saved.custom, baseURL: saved.custom.baseURL.replace("/generate", "/slow") },
        });
        const first = imageGenerator.generate({ prompt: "Cancel caller A" }, "caller-a").then(
          () => "ok",
          (e) => e.message,
        );
        const second = imageGenerator.generate({ prompt: "Keep caller B" }, "caller-b");
        setTimeout(() => imageGenerator.cancel("caller-a"), 100);
        const cancelled = await first;
        const kept = await second;
        await imageGenerator.set({ custom: saved.custom });
        // Chat calls above already used part of this launch's hourly MCP budget.
        for (let i = used; i < 5; i++)
          await imageGenerator.generate({ prompt: "Rate limit fixture" });
        const limited = await imageGenerator.generate({ prompt: "Must not spend" }).then(
          () => "ok",
          (e) => e.message,
        );
        await imageGenerator.set({ vendor: "google", clearKey: true });
        const descriptor = Object.getOwnPropertyDescriptor(app, "isPackaged");
        const override = process.env.VERYNIZE_TEST_IMAGE_GOOGLE_URL;
        let packaged;
        try {
          Object.defineProperty(app, "isPackaged", { value: true, configurable: true });
          process.env.VERYNIZE_TEST_IMAGE_GOOGLE_URL = "invalid-test-override";
          packaged = await imageGenerator
            .generate({ provider: "nano_banana_lite", prompt: "No key" }, "packaged-test")
            .then(
              () => "ok",
              (e) => e.message,
            );
        } finally {
          Object.defineProperty(app, "isPackaged", descriptor);
          process.env.VERYNIZE_TEST_IMAGE_GOOGLE_URL = override;
        }
        return { cancelled, width: kept.width, limited, packaged };
      },
      { modulePath: path.resolve("desktop/generate.cjs"), used: mcpCalls },
    );
    assert.match(service.cancelled, /canceled/);
    assert.equal(service.width, 40);
    assert.match(service.limited, /5 attempts per hour/);
    assert.match(service.packaged, /Add an API key for Google/);
    assert.doesNotMatch(logs, new RegExp(KEY + "|" + WRONG), "API keys never logged");
    console.log(
      `PASS image model providers: OpenAI-compatible + generic HTTP fixtures, real PNG inserted as layers from chat (MCP), key in ${secure ? (process.platform === "darwin" ? "mock keychain (safeStorage) across relaunch" : "safeStorage across relaunch") : "session memory"}, never returned/logged/plain-stored, redacted errors`,
    );
  } finally {
    await app.close().catch(() => {});
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
