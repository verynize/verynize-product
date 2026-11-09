// Real offscreen Chromium: run on Mac under /tmp/verynize-electron.lock (display scaling).
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vn-render-ready-"));
  let app, assetServer;
  try {
    const main = path.resolve(__dirname, "../scripts/render-test-main.cjs");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    delete env.ELECTRON_OVERRIDE_DIST_PATH;
    app = await _electron.launch({
      args: [main, "--user-data-dir=" + path.join(dir, "profile")],
      env,
      timeout: 20000,
    });
    app.process().stderr.on("data", (chunk) => {
      if (String(chunk).includes("[render]")) process.stderr.write(chunk);
    });
    const page = await app.firstWindow();
    await page.addScriptTag({ path: path.resolve(__dirname, "../web/asset-store.js") });
    const offline = await page.evaluate(async () => {
      window.verynizePlatform = { kind: "web" };
      const blob = new Blob(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
        ],
        { type: "image/svg+xml" },
      );
      const ref = await window.assetStore.put(blob);
      const again = await window.assetStore.put(blob);
      return { ref, again, text: await (await window.assetStore.get(ref)).text() };
    });
    assert.equal(offline.ref, offline.again);
    assert.ok(offline.text.includes("<svg"));
    await page.reload();
    await page.addScriptTag({ path: path.resolve(__dirname, "../web/asset-store.js") });
    assert.equal(
      await page.evaluate(async (ref) => (await window.assetStore.get(ref)).size, offline.ref),
      Buffer.byteLength(offline.text),
    );
    const large = await app.evaluate(async ({ nativeImage }) => {
      const r = await global.render.renderHTML({
        html: '<body style="margin:0"><div data-id="board" style="width:18420px;height:5313px;background:red;position:relative"><div style="position:absolute;right:0;bottom:0;width:100px;height:100px;background:blue"></div></div>',
        width: 18420,
        height: 5313,
        scale: 1,
        screenshot: true,
      });
      return {
        width: r.width,
        height: r.height,
        scale: r.scale,
        box: r.boxes.board,
        empty: nativeImage.createFromDataURL(r.dataURL).isEmpty(),
      };
    });
    assert.equal(large.empty, false);
    assert.ok(large.width <= 8192);
    assert.ok(large.scale < 1);
    assert.ok(Math.abs(large.box.w - 18420) < 1);
    assert.ok(Math.abs(large.box.h - 5313) < 1);
    const toolShot = await app.evaluate((_electron, root) => global.captureTool(root), dir);
    assert.equal(toolShot.image, true);
    assert.equal(toolShot.receipt.screenshot.source, "offscreen");
    assert.ok(toolShot.receipt.screenshot.width <= 4096);
    let fetched = 0;
    assetServer = require("node:http").createServer((_request, response) => {
      fetched++;
      response.writeHead(200, { "content-type": "image/svg+xml" });
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>',
      );
    });
    await new Promise((resolve) => assetServer.listen(0, "127.0.0.1", resolve));
    const roomUrl = `http://127.0.0.1:${assetServer.address().port}/api/rooms/00000000-0000-0000-0000-000000000000/assets/00000000-0000-0000-0000-000000000001?sig=${"a".repeat(64)}`;
    const roomShot = await app.evaluate(
      (_electron, url) =>
        global.render.renderHTML({
          html: `<body style="margin:0;background-image:url('${url}')"><img src="${url}" width="8" height="8">`,
          width: 8,
          height: 8,
        }),
      roomUrl,
    );
    assert.equal(roomShot.width, 8);
    assert.equal(fetched, 1);

    const retry = await app.evaluate(async () => {
      const html = `<body style="margin:0"><div data-id="box" style="width:100px;height:80px;background:red"></div><script>
        let changes=0;const observer=new MutationObserver(()=>{if(++changes===1)document.documentElement.style.zoom='1';});
        observer.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
      </script>`;
      return global.render.renderHTML({ html, width: 100, height: 80, scale: 0.1 });
    });
    assert.equal(retry.width, 10);
    assert.ok(Math.abs(retry.boxes.box.w - 100) < 1);
    const bad = await app.evaluate(async () => {
      try {
        await global.render.renderHTML({
          html: `<body><script>
        const face=new FontFace('Broken','url(data:font/woff2;base64,AAAA)');document.fonts.add(face);
      </script>`,
          width: 100,
          height: 80,
        });
      } catch (e) {
        return e.message;
      }
    });
    assert.match(bad, /after retry/);
    const assetRender = await app.evaluate(
      async (_electron, fontBase64) => {
        const store = await global.renderAssets.store();
        const image = await store.put(
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>',
          ),
          "image/svg+xml",
        );
        const font = await store.put(Buffer.from(fontBase64, "base64"), "font/woff2");
        const html = `<style>@font-face{font-family:AssetTest;src:url(${font.ref});font-weight:400;font-style:normal}</style><body style="margin:0"><div data-id="fill" style="width:100px;height:80px;background-image:url(${image.ref})"><img src="${image.ref}" width="10" height="10"><span style="font-family:AssetTest">Asset</span></div>`;
        const shot = await global.render.renderHTML({ html, width: 100, height: 80 });
        const png = _electron.nativeImage.createFromDataURL(shot.dataURL);
        return {
          imageRef: image.ref,
          loaded: shot.fonts.loaded,
          missing: shot.fonts.missing,
          empty: png.isEmpty(),
          box: shot.boxes.fill,
        };
      },
      (
        await fs.readFile(
          path.resolve(__dirname, "../web/assets/fonts/inter-latin-400-normal.woff2"),
        )
      ).toString("base64"),
    );
    assert.equal(assetRender.loaded, 1);
    assert.deepEqual(assetRender.missing, []);
    assert.equal(assetRender.empty, false);
    assert.equal(assetRender.box.w, 100);
    assert.equal(
      await page.evaluate(async (ref) => {
        window.verynizePlatform = { kind: "desktop" };
        return (await window.assetStore.get(ref)).type;
      }, assetRender.imageRef),
      "image/svg+xml",
    );
    const gone = await app.evaluate(async ({ app }) => {
      app.once("browser-window-created", (_e, window) =>
        window.webContents.once("did-finish-load", () =>
          window.webContents.forcefullyCrashRenderer(),
        ),
      );
      try {
        await global.render.renderHTML({ html: "<body/>", width: 100, height: 80 });
      } catch (e) {
        return e.message;
      }
    });
    assert.match(gone, /renderer-process-gone/);
    const childGone = await app.evaluate(async ({ app }) => {
      app.once("browser-window-created", (_event, window) =>
        window.webContents.once("did-finish-load", () => {
          const gpu = app.getAppMetrics().find((metric) => metric.type === "GPU");
          if (gpu) process.kill(gpu.pid, "SIGKILL");
        }),
      );
      try {
        await global.render.renderHTML({
          html: "<body><script>requestAnimationFrame(()=>{const end=performance.now()+500;while(performance.now()<end){}})</script>",
          width: 8,
          height: 8,
        });
      } catch (error) {
        return error.message;
      }
    });
    assert.match(childGone, /child-process-gone/);
    // Fully transparent output is ambiguous (intentional empty artwork or a lost compositor
    // frame). Fail closed after retry, then prove that refusal does not poison the queue.
    const blank = await app.evaluate(async () => {
      try {
        await global.render.renderHTML({ html: "<body/>", width: 100, height: 80, scale: 27 });
      } catch (error) {
        return error.message;
      }
    });
    assert.match(blank, /fully transparent after retry; capture refused/);
    const recovery = await app.evaluate(() =>
      global.render.renderHTML({ html: '<body style="background:red"/>', width: 8, height: 8 }),
    );
    assert.equal(recovery.width, 8);
    const recoveredPixel = await app.evaluate(
      ({ nativeImage }, dataURL) => [
        ...nativeImage.createFromDataURL(dataURL).toBitmap().subarray(0, 4),
      ],
      recovery.dataURL,
    );
    assert.deepEqual(recoveredPixel, [0, 0, 255, 255], "queue recovers with painted red pixels");
    console.log(
      "PASS large 18420×5313, zoom retry, font refusal, actual renderer crash, blank 2160p refusal and painted queue recovery",
    );
  } finally {
    assetServer?.closeAllConnections();
    if (assetServer) await new Promise((resolve) => assetServer.close(resolve));
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
