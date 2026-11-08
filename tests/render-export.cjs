// Native export must scale the artwork itself, not only the output PNG dimensions.
const { _electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'better-render-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`, ...(process.env.TEST_RENDER_DEVICE_SCALE ? ['--force-device-scale-factor=' + process.env.TEST_RENDER_DEVICE_SCALE] : [])], env, timeout: 20000 });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector('#canvas');
    // A body larger than Chromium's URL limit, then a large board at 3×. Monitor crashes in
    // the main process so a restarted GPU cannot conceal the failure behind a successful PNG.
    await app.evaluate(({ app }) => {
      global.renderCrashes = [];
      app.on('child-process-gone', (_event, details) => {
        if (details.type === 'GPU') global.renderCrashes.push(details);
      });
      app.on('render-process-gone', (_event, _contents, details) => global.renderCrashes.push(details));
    });
    for (const large of [false, true]) {
      const result = await page.evaluate(async large => {
        const width = large ? 6160 : 100, height = large ? 4272 : 80;
        const html = '<!doctype html><html><body style="margin:0"><div data-id="large" style="width:' + width + 'px;height:' + height + 'px;position:relative;background:rgb(255,0,0)"><div style="position:absolute;right:0;bottom:0;width:10%;height:10%;background:blue"></div></div><!--' + 'x'.repeat(2600000) + '--></body></html>';
        const raster = await window.desktop.renderDesign({ html, width, height, scale: large ? 3 : 1, screenshot: true });
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = raster.dataURL; });
        // Sample the bottom-right corner without allocating another full-size canvas.
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, image.width - 2, image.height - 2, 1, 1, 0, 0, 1, 1);
        return { width: image.width, height: image.height, reportedWidth: raster.width, reportedHeight: raster.height,
          scale: raster.scale, requestedScale: raster.requestedScale, pixel: [...ctx.getImageData(0, 0, 1, 1).data],
          box: raster.boxes.large, png: raster.dataURL.startsWith('data:image/png;base64,') };
      }, large);
      assert.ok(result.png);
      assert.equal(result.width, result.reportedWidth);
      assert.equal(result.height, result.reportedHeight);
      assert.deepEqual(result.pixel, [0, 0, 255, 255], JSON.stringify({large, ...result}));
      assert.ok(result.width <= 8192 && result.height <= 8192);
      assert.equal(result.requestedScale, large ? 3 : 1);
      assert.ok(result.scale > 0 && result.scale <= (large ? 3 : 1));
      if (large) assert.ok(result.scale < 3);
      assert.ok(Math.abs(result.box.w - (large ? 6160 : 100)) < 1);
      assert.ok(Math.abs(result.box.h - (large ? 4272 : 80)) < 1);
    }
    const oversizedExport = await page.evaluate(async () => {
      try { await window.desktop.renderDesign({ html: '<div/>', width: 6160, height: 4272, scale: 3 }); }
      catch (error) { return error.message; }
    });
    assert.match(oversizedExport, /Lower the export scale/);
    assert.deepEqual(await app.evaluate(() => global.renderCrashes), []);
    assert.equal(await page.evaluate(() => !!window.design), true, 'editor survives large renders');
    console.log('PASS >2.5 MB HTML and 6160×4272 at 3×: PNG pixels, bounded scale, export rejection, GPU and editor survival');
    // 7.2 / 27 cover the 720p and 2160p presets of 100×80 artwork: past Chromium's 5× page zoom cap the
    // renderer adds CSS zoom, which must still fill the whole output and keep measurements in CSS px.
    for (const scale of [0.1, 0.5, 1, 2, 4, 5.12, 7.2, 27]) {
      const result = await page.evaluate(async scale => {
        // Deliberately transparent body: propagating a body background over the viewport can
        // hide an unscaled drawing surrounded by empty space. Only these explicit boxes paint.
        const result = await window.desktop.renderDesign({
          html: '<html><body style="margin:0;background:transparent"><div data-id="art" style="position:relative;width:100px;height:80px"><div data-id="left" style="position:absolute;left:0;top:0;width:50px;height:80px;background:red"></div><div data-id="right" style="position:absolute;left:50px;top:0;width:50px;height:80px;background:blue"></div></div></body></html>',
          width: 100, height: 80, scale,
        });
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = result.dataURL; });
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixel = (x, y) => [...context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data];
        return {
          width: image.width, height: image.height,
          leftTop: pixel(37, 10), leftBottom: pixel(37, 70),
          rightTop: pixel(87, 10), rightBottom: pixel(87, 70),
          boxes: result.boxes,
        };
      }, scale);
      assert.equal(result.width, Math.ceil(100 * scale - 1e-6), `${scale}× PNG width`);
      assert.equal(result.height, Math.ceil(80 * scale - 1e-6), `${scale}× PNG height`);
      assert.deepEqual(result.leftTop, [255, 0, 0, 255], `${scale}× artwork's left half scales horizontally`);
      assert.deepEqual(result.leftBottom, [255, 0, 0, 255], `${scale}× artwork scales vertically`);
      assert.deepEqual(result.rightTop, [0, 0, 255, 255], `${scale}× right half fills the output`);
      assert.deepEqual(result.rightBottom, [0, 0, 255, 255], `${scale}× lower-right artwork is not empty or clipped`);
      const near = (b, e) => Object.entries(e).every(([k, v]) => Math.abs(b[k] - v) < 0.01);
      assert.ok(near(result.boxes.art, { x: 0, y: 0, w: 100, h: 80 }), `${scale}× layout boxes stay in document CSS pixels: ${JSON.stringify(result.boxes.art)}`);
      assert.ok(near(result.boxes.right, { x: 50, y: 0, w: 50, h: 80 }), `${scale}× zoom does not leak into measured positions: ${JSON.stringify(result.boxes.right)}`);
    }
    // Invalid scales fail before rendering.
    const rejected = await page.evaluate(async () => {
      try { await window.desktop.renderDesign({ html: '<div></div>', width: 100, height: 80, scale: 200 }); return null; } catch (error) { return String(error.message || error); }
    });
    assert.match(rejected || '', /Invalid render dimensions/);
    console.log('PASS native export at 0.1×/0.5×/1×/2×/4×/5.12×/7.2×/27×: artwork pixels, full output coverage, unscaled layout measurements and output limits');
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
