import { IMAGE_FILL_TYPES } from "./document-core.mjs";
// Image provider adapters against local HTTP fixture servers that return real PNG/JPEG bytes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import {
  generateImage,
  normalizeSettings,
  inspectImage,
  redact,
  IMAGE_PROVIDERS,
  DEFAULT_IMAGE_PROVIDER,
  migrateSettings,
  providerSettings,
} from "./image-provider.mjs";

const { png } = createRequire(import.meta.url)("../tests/fixtures/png.cjs");
const KEY = "sk-fixture-0123456789abcdef";
const photo = png(64, 40, (x, y) => [x * 4, y * 6, 128]);
const requests = [];
let server, base;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      requests.push({
        url: req.url,
        method: req.method,
        auth: req.headers.authorization || "",
        googleKey: req.headers["x-goog-api-key"],
        body: body ? JSON.parse(body) : null,
      });
      if (req.url.startsWith("/models/")) {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "Done" },
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
        if (req.headers.authorization !== "Bearer " + KEY) {
          res.statusCode = 401;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message: `Incorrect API key provided: ${(req.headers.authorization || "").slice(7)}`,
              },
            }),
          );
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: photo.toString("base64") }] }));
        return;
      }
      if (req.url === "/url/images/generations") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ url: base + "/files/result.png" }] }));
        return;
      }
      if (req.url === "/files/result.png") {
        if (req.headers.authorization) {
          res.statusCode = 400;
          res.end("key leaked to file host");
          return;
        }
        res.setHeader("content-type", "image/png");
        res.end(photo);
        return;
      }
      if (req.url === "/raw") {
        res.setHeader("content-type", "image/png");
        res.end(photo);
        return;
      }
      if (req.url === "/json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ image: "data:image/png;base64," + photo.toString("base64") }));
        return;
      }
      if (req.url === "/not-image") {
        res.setHeader("content-type", "image/png");
        res.end("<html>nope</html>");
        return;
      }
      if (req.url === "/slow") {
        setTimeout(() => {
          res.setHeader("content-type", "image/png");
          res.end(photo);
        }, 2000);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => new Promise((r) => server.close(r)));

test("settings: https anywhere, plain http only on loopback, no credentials in URL", () => {
  assert.deepEqual(normalizeSettings({}), {
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-image-2",
    size: "1024x1024",
  });
  assert.equal(
    normalizeSettings({ provider: "http", baseURL: "http://localhost:8080/gen/" }).baseURL,
    "http://localhost:8080/gen",
  );
  assert.throws(() => normalizeSettings({ baseURL: "http://images.example.com/v1" }), /https/);
  assert.throws(() => normalizeSettings({ baseURL: "https://u:p@example.com/v1" }), /credentials/);
  assert.throws(() => normalizeSettings({ baseURL: "https://example.com/v1?key=1" }), /query/);
  assert.throws(() => normalizeSettings({ provider: "mystery" }), /Provider/);
  assert.throws(() => normalizeSettings({ size: "9999x9999" }), /size/);
});

test("OpenAI-compatible provider: request shape, bearer key and decoded PNG", async () => {
  const result = await generateImage({
    settings: {
      provider: "openai",
      baseURL: base + "/v1",
      model: "fixture-image-model",
      size: "1024x1024",
    },
    apiKey: KEY,
    prompt: "A misty pine forest at dawn",
  });
  const req = requests.at(-1);
  assert.equal(req.method, "POST");
  assert.equal(req.auth, "Bearer " + KEY);
  assert.deepEqual(req.body, {
    model: "fixture-image-model",
    prompt: "A misty pine forest at dawn",
    n: 1,
    size: "1024x1024",
  });
  assert.equal(result.mime, "image/png");
  assert.equal(result.width, 64);
  assert.equal(result.height, 40);
  assert.deepEqual(Buffer.from(result.src.replace("data:image/png;base64,", ""), "base64"), photo);
});

test("hosted result URLs are downloaded without the API key", async () => {
  const result = await generateImage({
    settings: { provider: "openai", baseURL: base + "/url", model: "m" },
    apiKey: KEY,
    prompt: "x",
  });
  assert.equal(result.width, 64);
  assert.equal(requests.at(-1).url, "/files/result.png");
  assert.equal(requests.at(-1).auth, "");
});

test("generic HTTP provider: raw image bytes or JSON data URL, key optional", async () => {
  const raw = await generateImage({
    settings: { provider: "http", baseURL: base + "/raw", model: "local-sdxl", size: "1024x1536" },
    prompt: "portrait",
  });
  assert.deepEqual(requests.at(-1).body, {
    prompt: "portrait",
    model: "local-sdxl",
    width: 1024,
    height: 1536,
  });
  assert.equal(requests.at(-1).auth, "");
  assert.equal(raw.height, 40);
  const json = await generateImage({
    settings: { provider: "http", baseURL: base + "/json" },
    apiKey: "generic-token-xyz",
    prompt: "p",
  });
  assert.equal(requests.at(-1).auth, "Bearer generic-token-xyz");
  assert.equal(json.mime, "image/png");
});

test("errors never contain the API key; non-images and cancellation are rejected", async () => {
  const wrong = "sk-wrong-key-abcdef123456";
  await assert.rejects(
    generateImage({
      settings: { provider: "openai", baseURL: base + "/v1" },
      apiKey: wrong,
      prompt: "x",
    }),
    (e) => {
      assert.match(e.message, /401 \(check the API key\)/);
      assert.doesNotMatch(e.message, /sk-wrong-key/);
      return true;
    },
  );
  await assert.rejects(
    generateImage({
      settings: { provider: "openai", baseURL: base + "/v1" },
      apiKey: "",
      prompt: "x",
    }),
    /Add an API key/,
  );
  await assert.rejects(
    generateImage({ settings: { provider: "http", baseURL: base + "/not-image" }, prompt: "x" }),
    /PNG, JPEG or WebP/,
  );
  await assert.rejects(
    generateImage({ settings: { provider: "http", baseURL: base + "/missing" }, prompt: "x" }),
    /404/,
  );
  await assert.rejects(
    generateImage({ settings: { provider: "http", baseURL: base + "/raw" }, prompt: " " }),
    /Describe/,
  );
  const controller = new AbortController();
  const pending = generateImage({
    settings: { provider: "http", baseURL: base + "/slow" },
    prompt: "x",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /canceled/);
});

test("image inspection and redaction helpers", () => {
  assert.deepEqual(inspectImage(photo), { mime: "image/png", width: 64, height: 40 });
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00,
    0x50, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.deepEqual(inspectImage(jpeg), { mime: "image/jpeg", width: 80, height: 48 });
  assert.equal(inspectImage(Buffer.from("GIF89a......")), null);
  assert.equal(
    redact(`bad key ${KEY} and Bearer abcdefghijklmnop`, KEY),
    "bad key [redacted] and Bearer [redacted]",
  );
});

test("catalog, fresh default, migration and vendor routing", () => {
  assert.equal(new Set(IMAGE_PROVIDERS.map((p) => p.id)).size, IMAGE_PROVIDERS.length);
  for (const p of IMAGE_PROVIDERS) {
    assert.ok(p.label);
    assert.ok(["codex", "google", "openai", "custom"].includes(p.vendor));
    if (!["custom", "codex"].includes(p.vendor)) assert.ok(p.model);
  }
  assert.deepEqual(IMAGE_FILL_TYPES, ["frame", "rectangle"]);
  assert.equal(IMAGE_PROVIDERS[0].label, "Codex · ChatGPT plan");
  const fresh = migrateSettings();
  assert.equal(fresh.defaultProvider, DEFAULT_IMAGE_PROVIDER);
  assert.equal(providerSettings(fresh).model, "gemini-3.1-flash-lite-image");
  const old = {
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    model: "old-model",
    size: "1024x1024",
    key: "ciphertext",
  };
  const migrated = migrateSettings(old);
  assert.equal(migrated.defaultProvider, "custom");
  assert.equal(migrated.keys.custom, "ciphertext");
  assert.equal(migrated.keys.openai, "ciphertext");
  assert.equal(migrated.custom.model, "old-model");
  assert.deepEqual(migrateSettings(migrated), migrated);
  assert.throws(() => providerSettings(fresh, "missing"), /Unknown/);
  assert.equal(redact("bad AIza123456789abcdefghijk"), "bad [redacted]");
  assert.equal(redact("key: xyz", "xyz"), "key: [redacted]");
});
test("Gemini uses header key, generateContent and inline image parts", async () => {
  const saved = migrateSettings();
  const settings = providerSettings(saved, undefined, { google: base });
  const result = await generateImage({
    settings,
    apiKey: "AIza-fixture123456789",
    prompt: "A mountain",
  });
  const req = requests.at(-1);
  assert.equal(req.url, "/models/gemini-3.1-flash-lite-image:generateContent");
  assert.equal(req.auth, "");
  assert.equal(req.googleKey, "AIza-fixture123456789");
  assert.deepEqual(req.body, {
    contents: [{ parts: [{ text: "A mountain" }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  assert.equal(result.width, 64);
  assert.equal(result.height, 40);
});

test("settings recover unknown providers and invalid custom blocks", () => {
  for (const value of [
    null,
    { version: 2, defaultProvider: "retired", custom: { baseURL: "bad" } },
    { version: 2, custom: null },
  ]) {
    const settings = migrateSettings(value);
    assert.equal(settings.defaultProvider, DEFAULT_IMAGE_PROVIDER);
    assert.equal(settings.custom.model, "gpt-image-2");
  }
  for (const model of ["gpt-image-1", "dall-e-2", "dall-e-3"]) {
    assert.equal(
      migrateSettings({
        provider: "openai",
        baseURL: "https://api.openai.com/v1",
        model,
        key: "cipher",
      }).defaultProvider,
      "openai_gpt_image_2",
    );
  }
  assert.throws(() => normalizeSettings({ size: "512x512" }), /Unsupported/);
  assert.match(providerSettings(migrateSettings()).baseURL, /v1beta$/);
});
test("Gemini skips thoughts and takes the last output image", async () => {
  const result = await generateImage({
    settings: providerSettings(migrateSettings()),
    apiKey: "fixture",
    prompt: "Landscape",
    fetch: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { data: png(12, 12, [0, 0, 0]).toString("base64") } },
                  { text: "Final" },
                  { inlineData: { data: photo.toString("base64") } },
                  { thought: true, inlineData: { data: png(8, 8, [0, 0, 0]).toString("base64") } },
                ],
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(result.width, 64);
  assert.equal(result.height, 40);
});
test("provider output respects the renderer's 8 MB limit", async () => {
  await assert.rejects(
    generateImage({
      settings: { provider: "http", baseURL: "http://localhost/image" },
      prompt: "Large fixture",
      fetch: async () =>
        new Response(new Uint8Array(8_000_001), { headers: { "content-type": "image/png" } }),
    }),
    /8 MB/,
  );
  const saved = migrateSettings({
    provider: "openai",
    baseURL: "https://custom.example/v1",
    size: "bad",
    key: "custom-cipher",
  });
  assert.equal(saved.keys.custom, "custom-cipher");
  assert.equal(saved.keys.openai, undefined);
});

test("Codex provider uses shared validation and preserves explicit choices", async () => {
  const fresh = migrateSettings();
  assert.equal(fresh.providerChosen, false);
  // A keyless old default never worked, so it may move to Codex; anything else was a real choice.
  assert.equal(
    migrateSettings({ version: 2, defaultProvider: "nano_banana_lite" }).providerChosen,
    false,
  );
  assert.equal(
    migrateSettings({ version: 2, defaultProvider: "nano_banana_lite", keys: { google: "c" } })
      .providerChosen,
    true,
  );
  assert.equal(
    migrateSettings({ version: 2, defaultProvider: "openai_gpt_image_2" }).providerChosen,
    true,
  );
  assert.equal(
    migrateSettings({ ...fresh, defaultProvider: "codex_plan", providerChosen: true })
      .defaultProvider,
    "codex_plan",
  );
  const settings = providerSettings(fresh, "codex_plan");
  const result = await generateImage({ settings, prompt: "Teapot", codex: async () => photo });
  assert.equal(result.width, 64);
  assert.equal(result.provider, "codex");
  await assert.rejects(
    generateImage({ settings, prompt: "Teapot", codex: async () => Buffer.from("invalid") }),
    /PNG, JPEG or WebP/,
  );
  await assert.rejects(generateImage({ settings, prompt: "Teapot" }), /sign in to Codex/);
});
