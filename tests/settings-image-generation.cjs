const { waitForAsync } = require("./helpers/wait-for-async.cjs");
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { png } = require("./fixtures/png.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.homedir(), ".cache", "settings-image-"));
  const photo = png(96, 64, [60, 120, 180]);
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.setHeader("content-type", "image/png");
      res.end(photo);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_DISABLE_USAGE_PROBES: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERYNIZE_DISABLE_MCP;
  let app, page;
  const launch = async () => {
    app = await _electron.launch({
      env,
      args: ["--use-mock-keychain", ".", `--user-data-dir=${dir}`],
    });
    page = await app.firstWindow();
    await waitForUiReady(page);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.evaluate(() => (document.documentElement.dataset.uiTheme = "dark"));
    await page.evaluate(() => window.appSettings.open("preferences"));
    await page.locator("#settings-image-provider:not([disabled])").waitFor();
  };
  const capture = async (name) => {
    if (!process.env.WP3_SCREENSHOTS) return;
    await fs.mkdir(process.env.WP3_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.WP3_SCREENSHOTS, name),
      animations: "disabled",
    });
  };
  try {
    await launch();
    const initial = await page.evaluate(() => window.desktop.imageProvider.get());
    const catalog = initial.providers || [
      { id: "custom", label: "Custom endpoint", vendor: "custom" },
    ];
    await page.locator("#settings-image-provider").click();
    assert.deepEqual(
      await page.getByRole("option").allTextContents(),
      catalog.map((p) => p.label),
    );
    const selected = page.getByRole("option", { selected: true });
    assert.equal(
      await selected.textContent(),
      catalog.find((p) => p.id === (initial.defaultProvider || "custom")).label,
    );
    assert.equal(
      await selected.locator("[data-provider-current]").count(),
      1,
      "current provider has a dot",
    );
    await page.waitForTimeout(250);
    await capture("settings-provider-open.png");
    const custom = catalog.find((p) => p.vendor === "custom");
    await page.getByRole("option", { name: custom.label, exact: true }).click();
    if (initial.providers)
      await waitForAsync(
        page,
        (id) => window.desktop.imageProvider.get().then((s) => s.defaultProvider === id),
        custom.id,
      );
    assert.ok(catalog.some((provider) => provider.id === "codex_plan"));
    const apiKeys = page.getByText("Use your own API key", { exact: true });
    assert.equal(await page.locator("#settings-image-key-google").isVisible(), false);
    await apiKeys.click();
    // Exercise every key row the real backend supports, without sending a vendor request.
    const vendors = initial.keys ? ["google", "openai", "custom"] : ["custom"];
    for (const vendor of vendors) {
      const key = `fixture-image-${vendor}-secret`;
      const input = page.locator(`#settings-image-key-${vendor}`);
      const row = input.locator("../..");
      await input.fill("  " + key + "  ");
      await row.getByRole("button", { name: "Save", exact: true }).click();
      await row.getByText(/Saved securely|Saved for this session/).waitFor();
      assert.equal(await input.inputValue(), "");
      assert.ok(!(await page.locator("body").innerText()).includes(key));
      assert.ok(
        !(
          await page.evaluate(
            () =>
              JSON.stringify(localStorage) +
              JSON.stringify(sessionStorage) +
              JSON.stringify(window.design.getDocument()),
          )
        ).includes(key),
      );
      assert.ok(
        !JSON.stringify(await page.evaluate(() => window.desktop.imageProvider.get())).includes(
          key,
        ),
      );
      await row.getByRole("button", { name: "Remove", exact: true }).click();
      await row.getByText("No key saved").waitFor();
    }
    const badKey = page.locator("#settings-image-key-google");
    await badKey.fill("invalid key");
    await badKey.locator("../..").getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Invalid API key" }).waitFor();
    await app.close();
    await launch();
    assert.equal(await page.locator("#settings-image-provider").textContent(), custom.label);
    const saved = await page.evaluate(() => window.desktop.imageProvider.get());
    assert.equal(saved.defaultProvider || "custom", custom.id);
    await page.evaluate(
      (url) =>
        window.desktop.imageProvider.set({
          provider: "http",
          baseURL: url,
          model: "fixture",
          clearKey: true,
        }),
      `http://127.0.0.1:${server.address().port}/generate`,
    );
    await page.evaluate(() => {
      window.appSettings.close();
      window.fileLibrary.showEditor();
    });
    const rectangle = await page.evaluate(() =>
      window.design.addNode("rectangle", { x: 10, y: 20, w: 200, h: 100 }),
    );
    assert.equal(
      await page.locator("#generate-art, #generate-dialog").count(),
      0,
      "images are generated from chat, not a dialog",
    );
    // Chat agents reach the generator through the live MCP bridge's generate_image tool.
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    let info;
    for (let i = 0; i < 100 && !info; i++)
      info = await fs
        .readFile(path.join(dir, "mcp.json"), "utf8")
        .then(JSON.parse)
        .catch(() => new Promise((resolve) => setTimeout(resolve, 100)));
    assert.ok(info, "MCP bridge started");
    const client = new Client({ name: "settings-image-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(info.url), {
        requestInit: { headers: { Authorization: `Bearer ${info.token}` } },
      }),
    );
    const generate = async (args) => {
      const result = await client.callTool({ name: "generate_image", arguments: args });
      assert.ok(!result.isError, result.content?.[0]?.text);
      return result;
    };
    try {
      await generate({ prompt: "A blue ceramic tile", element: rectangle });
      let nodes = await page.evaluate(() =>
        window.design.getDocument().pages.flatMap((p) => p.nodes),
      );
      const [fill] = nodes.find((n) => n.id === rectangle).fills;
      assert.equal(fill.type, "image");
      assert.equal(fill.fit, "cover");
      assert.match(fill.src, /^data:image\//);
      assert.deepEqual([fill.imageWidth, fill.imageHeight], [96, 64]);
      assert.equal(nodes.filter((n) => n.type === "image").length, 0);
      await generate({ prompt: "A second tile" });
      nodes = await page.evaluate(() => window.design.getDocument().pages.flatMap((p) => p.nodes));
      const image = nodes.find((n) => n.type === "image");
      assert.ok(image, "inserted as an image layer");
      assert.deepEqual([image.w, image.h], [96, 64]);
      await page.locator(`#canvas [data-id="${image.id}"]`).waitFor({ state: "attached" });
    } finally {
      await client.close().catch(() => {});
    }
    assert.equal(requests.length, 2);
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal(
      await page.evaluate(
        () =>
          window.design
            .getDocument()
            .pages.flatMap((p) => p.nodes)
            .filter((n) => n.type === "image").length,
      ),
      0,
    );
    console.log(
      `PASS settings image generation (${initial.providers ? "catalog" : "v1 fallback"}): provider, keys, relaunch, chat (MCP) fill, insertion, undo`,
    );
  } finally {
    await app?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
