const { onWindowClosed } = require("./window-cleanup.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { isEncryptionAvailable, seal, unseal } = require("./secure-storage.cjs");
const { pathToFileURL } = require("node:url");
const codexImage = require("./codex-image.cjs");
function registerGeneration(handle, parent) {
  onWindowClosed(parent, () => imageGenerator.cancel(parent));
  handle("imageProviderGet", () => imageGenerator.get());
  handle("imageProviderSet", (options) => imageGenerator.set(options));
  handle("generateImage", (options) => imageGenerator.generate(options, parent));
}

// One service shared by all windows and MCP. Only ciphertext is persisted.
function createImageGenerator() {
  const settingsFile = () => path.join(app.getPath("userData"), "image-provider.json");
  const sessionKeys = {};
  const imageAborts = new Map();
  const mcpAttempts = [];
  let queue = Promise.resolve();
  const load = () =>
    import(pathToFileURL(path.join(__dirname, "../integrations/image-provider.mjs")).href);
  const secure = () => isEncryptionAvailable(safeStorage);
  async function save(settings) {
    await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
    const temp = settingsFile() + "." + process.pid + ".tmp";
    await fs.writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    await fs.rename(temp, settingsFile());
  }
  async function read() {
    let raw = {};
    try {
      raw = JSON.parse(await fs.readFile(settingsFile(), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        await fs.copyFile(settingsFile(), settingsFile() + ".bak");
      }
    }
    const engine = await load();
    const saved = engine.migrateSettings(raw);
    if (raw?.version !== 2) await save(saved);
    if (
      !saved.providerChosen &&
      !Object.values(saved.keys).some(Boolean) &&
      !Object.values(sessionKeys).some(Boolean)
    )
      saved.defaultProvider = (await codexImage.status()).available
        ? "codex_plan"
        : engine.DEFAULT_IMAGE_PROVIDER;
    return saved;
  }
  async function key(saved, vendor) {
    if (saved.keys[vendor] && (await secure())) {
      try {
        return await unseal(safeStorage, saved.keys[vendor]);
      } catch {
        return "";
      }
    }
    return sessionKeys[vendor] || "";
  }
  async function publicSettings(saved) {
    const engine = await load();
    const keys = Object.fromEntries(
      await Promise.all(
        ["openai", "google", "custom"].map(async (v) => {
          const hasKey = !!(await key(saved, v));
          return [
            v,
            { hasKey, keyStorage: hasKey ? (saved.keys[v] ? "keychain" : "session") : "none" },
          ];
        }),
      ),
    );
    const codex = await codexImage.status();
    return {
      defaultProvider: saved.defaultProvider,
      providers: engine.IMAGE_PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        vendor: p.vendor,
        model: p.vendor === "custom" ? saved.custom.model : p.model,
        hasKey: keys[p.vendor]?.hasKey || false,
        ...(p.vendor === "codex" ? { status: codex.status } : {}),
        available:
          p.vendor === "codex"
            ? codex.available
            : keys[p.vendor].hasKey || (p.vendor === "custom" && saved.custom.provider === "http"),
      })),
      keys,
      custom: saved.custom,
      secureStorage:
        Object.keys(saved.keys).length || Object.keys(sessionKeys).length ? await secure() : null,
      ...saved.custom,
      ...keys.custom,
      configured:
        saved.defaultProvider === "codex_plan"
          ? codex.available
          : saved.defaultProvider === "custom" ||
            keys[engine.IMAGE_PROVIDERS.find((p) => p.id === saved.defaultProvider).vendor].hasKey,
    };
  }
  function locked(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }
  return {
    get: () => locked(async () => publicSettings(await read())),
    set: (options = {}) =>
      locked(async () => {
        if (!options || typeof options !== "object") throw Error("Provider settings are required");
        const engine = await load(),
          saved = await read();
        const legacy = Object.fromEntries(
          ["provider", "baseURL", "model", "size"]
            .filter((k) => options[k] !== undefined)
            .map((k) => [k, options[k]]),
        );
        const vendor = options.vendor || "custom";
        if (!["openai", "google", "custom"].includes(vendor)) throw Error("Unknown key vendor");
        if (
          options.defaultProvider &&
          !engine.IMAGE_PROVIDERS.some((p) => p.id === options.defaultProvider)
        )
          throw Error("Unknown image provider");
        if (options.custom || Object.keys(legacy).length) {
          const custom = engine.normalizeSettings({
            ...saved.custom,
            ...options.custom,
            ...legacy,
          });
          if (!["openai", "http"].includes(custom.provider)) throw Error("Invalid custom adapter");
        }
        const next = engine.migrateSettings({
          ...saved,
          providerChosen:
            saved.providerChosen || !!options.defaultProvider || !!Object.keys(legacy).length,
          defaultProvider:
            options.defaultProvider ??
            (Object.keys(legacy).length ? "custom" : saved.defaultProvider),
          custom: { ...saved.custom, ...options.custom, ...legacy },
        });
        if (
          options.apiKey !== undefined &&
          (typeof options.apiKey !== "string" ||
            options.apiKey.length > 4096 ||
            /\s/.test(options.apiKey))
        )
          throw Error("Invalid API key");
        if (options.clearKey) {
          delete next.keys[vendor];
          delete sessionKeys[vendor];
        }
        if (options.apiKey) {
          if (await secure()) {
            next.keys[vendor] = await seal(safeStorage, options.apiKey);
            delete sessionKeys[vendor];
          } else {
            delete next.keys[vendor];
            sessionKeys[vendor] = options.apiKey;
          }
        }
        await save(next);
        return publicSettings(next);
      }),
    cancel: (caller = "mcp") => imageAborts.get(caller)?.abort(),
    generate: async (options = {}, caller = "mcp") => {
      if (imageAborts.has(caller)) throw Error("An image is already being generated");
      if (caller === "mcp") {
        const now = Date.now();
        while (mcpAttempts.length && mcpAttempts[0] <= now - 3600000) mcpAttempts.shift();
        if (mcpAttempts.length >= 5)
          throw Error("Image generation limit reached (5 attempts per hour)");
        mcpAttempts.push(now);
      }
      const imageAbort = new AbortController();
      imageAborts.set(caller, imageAbort);
      const signal = imageAbort.signal;
      try {
        const saved = await locked(read),
          engine = await load();
        const id = options.provider || saved.defaultProvider;
        const entry = engine.IMAGE_PROVIDERS.find((p) => p.id === id);
        if (!entry) throw Error("Unknown image provider");
        // Test-only loopback overrides are never accepted through renderer IPC.
        const overrides = {};
        for (const vendor of ["google", "openai"]) {
          const raw = process.env["VERYNIZE_TEST_IMAGE_" + vendor.toUpperCase() + "_URL"];
          if (raw && !app.isPackaged) {
            const url = new URL(raw);
            if (
              url.protocol !== "http:" ||
              !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
            )
              throw Error("Image test override must be loopback HTTP");
            overrides[vendor] = raw;
          }
        }
        return await engine.generateImage({
          settings: {
            ...engine.providerSettings(saved, id, overrides),
            ...(options.size ? { size: options.size } : {}),
          },
          apiKey: await key(saved, entry.vendor),
          prompt: options.prompt,
          signal,
          codex: codexImage.generate,
        });
      } finally {
        imageAborts.delete(caller);
      }
    },
  };
}
const imageGenerator = createImageGenerator();
module.exports = { registerGeneration, imageGenerator };
