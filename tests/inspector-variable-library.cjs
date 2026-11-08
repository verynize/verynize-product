// Variable creation/export and malformed icon assets: real Electron UI regressions.
const { _electron } = require('@playwright/test');
const { waitForUiReady } = require('./helpers/ui-ready.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'bd-variable-library-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  let app;
  try {
    app = await _electron.launch({ env, args: ['.', `--user-data-dir=${profile}`], timeout: 20000 });
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await page.waitForSelector('#canvas .layer');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const doc = () => page.evaluate(() => window.design.getDocument());
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { brand: '#123456' };
      d.variables = { spacing: { type: 'dimension', value: 24 } };
      d.pages[0].nodes = [{ id: 'card', name: 'Card', type: 'frame', x: 20, y: 20, w: 120, h: 80, color: '#ffffff', token: 'brand' }];
      window.design.setDocument(d);
      window.design.setSelection(['card']);
    });
    const createColor = async name => {
      await page.locator('#add-color-token').waitFor({ state: 'detached' });
      await page.locator('#add-token').click();
      await page.locator('#add-color-token').click();
      await page.locator('#text-prompt-input').fill(name);
      await page.locator('#text-prompt-ok').click();
      await page.locator('#text-prompt-input').waitFor({ state: 'hidden' });
    };
    for (const name of ['brand', 'spacing', ' constructor ', 'bad;name']) {
      const before = await doc();
      await createColor(name);
      await page.waitForFunction(() => /already exists|Use letters/.test(document.querySelector('footer').textContent));
      assert.deepEqual(await doc(), before, `Rejected color name ${name} leaves the document intact`);
    }
    await createColor('brand/accent');
    await page.waitForFunction(() => window.design.getDocument().tokens['brand/accent'] === '#a58bdd');
    await page.locator('#insp-variables [data-token="brand/accent"]').waitFor({ state: 'visible' });
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), ['card']);
    assert.equal((await doc()).tokens.brand, '#123456');
    await page.locator('#undo').evaluate(button => button.click());
    await page.waitForFunction(() => !window.design.getDocument().tokens['brand/accent']);
    assert.equal((await doc()).tokens.brand, '#123456');

    // Ambiguous CSS export reports the alias and does not overwrite the clipboard.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { 'space-md': '#123456' };
      d.variables = { 'space/md': { type: 'dimension', value: 16 } };
      window.design.setDocument(d);
    });
    const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText());
    await page.locator('#variables-css').click();
    await page.locator('#copy-variables-css').click();
    await page.getByText(/both export as --space-md/).waitFor();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), clipboardBefore);

    // Documents can retain bad imported assets; clicking them must not throw or insert broken layers.
    const badSources = ['***', Buffer.from('not SVG').toString('base64'), Buffer.from('<svg><path></svg>').toString('base64')];
    await page.evaluate(sources => {
      window.design.setIcons(sources.map((source, index) => ({ id: `bad-${index}`, name: `Bad ${index}`, src: `data:image/svg+xml;base64,${source}` })));
    }, badSources);
    const header = page.locator('#insp-icons button[aria-expanded]').first();
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
    const before = await doc();
    for (let index = 0; index < badSources.length; index++) {
      await page.locator(`#insp-icons [data-icon-id="bad-${index}"]`).click();
      await page.getByText('This icon contains invalid SVG data. Upload or paste it again.').first().waitFor();
      assert.deepEqual(await doc(), before, 'Invalid icon insertion leaves the document intact');
    }
    // Actual SVG shape color is independent of the background and responds to a color variable.
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" fill="#000000"/></svg>').toString('base64');
    await page.evaluate(src => {
      const d = window.design.getDocument();
      d.tokens = { accent: '#ff8800' }; delete d.variables;
      d.pages[0].nodes = [{ id: 'svg', name: 'Tint sample', type: 'image', src, x: 100, y: 100, w: 64, h: 64, color: '#eeeeee' }];
      window.design.setDocument(d); window.design.setSelection(['svg']);
    }, svg);
    // The SVG colour is a Selection colors row (properties-audit A9, WP-6); the layer's own #eeeeee fill is another row.
    await page.locator('#selection-colors-section [data-selection-color="#000000"]').getByRole('button', { name: /^Selection color \d+$/ }).click();
    await page.locator('#color-dialog').getByRole('tab', { name: 'Variables', exact: true }).click();
    await page.getByRole('option', { name: /accent/ }).click();
    await page.getByRole('button', { name: 'Close colour picker', exact: true }).click();
    await page.locator('#color-dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => window.design.getDocument().pages[0].nodes[0].svgColorToken === 'accent');
    const imageLayer = page.locator('#canvas [data-id="svg"]');
    const paint = imageLayer.locator('[data-svg-color="true"]');
    assert.equal(await imageLayer.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(238, 238, 238)');
    assert.equal(await paint.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 136, 0)');
    const variablesHeader = page.locator('#insp-variables button[aria-expanded]').first();
    if ((await variablesHeader.getAttribute('aria-expanded')) === 'false') await variablesHeader.click();
    await page.locator('#insp-variables [data-token="accent"] button').first().click();
    await page.locator('#color-value').fill('00ff00');
    await page.locator('#color-value').press('Tab');
    await page.getByRole('button', { name: 'Close colour picker', exact: true }).click();
    await page.locator('#color-dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#canvas [data-svg-color]')).backgroundColor === 'rgb(0, 255, 0)');
    const pixels = await page.evaluate(async base64 => {
      // Canvas normalizes PNG color profiles to sRGB; macOS nativeImage.toBitmap uses display space.
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = 'data:image/png;base64,' + base64; });
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { colorSpace: 'srgb' }); context.drawImage(image, 0, 0);
      const pixel = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data);
      return { center: pixel(Math.floor(image.width / 2), Math.floor(image.height / 2)), corner: pixel(Math.floor(image.width / 8), Math.floor(image.height / 2)) };
    }, (await paint.screenshot()).toString('base64'));
    const nearPixel = (actual, expected, message) => assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 2), `${message}: ${actual}`);
    // Two levels allow the PNG display-profile to sRGB quantization round trip.
    nearPixel(pixels.center, [0, 255, 0, 255], 'SVG center renders green');
    nearPixel(pixels.corner, [238, 238, 238, 255], 'Outside the SVG shape preserves the gray background');
    if (process.env.VERYNIZE_EVIDENCE_DIR) {
      await fs.mkdir(process.env.VERYNIZE_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.VERYNIZE_EVIDENCE_DIR, 'svg-color-variable.png') });
    }
    await page.getByRole('button', { name: 'Detach SVG color variable', exact: true }).click();
    assert.equal((await doc()).pages[0].nodes[0].svgColor, '#00ff00');
    assert.equal((await doc()).pages[0].nodes[0].svgColorToken, undefined);
    assert.equal((await doc()).pages[0].nodes[0].src, svg);
    await page.reload(); await waitForUiReady(page); await page.waitForSelector('#canvas [data-svg-color="true"]');
    assert.equal((await doc()).pages[0].nodes[0].src, svg);
    assert.match(await page.evaluate(() => window.design.exportHTML()), /mask-mode: alpha|mask-mode:alpha/);
    await page.evaluate(() => window.design.setSelection(['svg']));
    await page.getByRole('button', { name: 'Restore original SVG colors', exact: true }).click();
    assert.equal((await doc()).pages[0].nodes[0].svgColor, undefined);
    await imageLayer.locator('img').waitFor();
    await page.evaluate(() => {
      const d = window.design.getDocument(), first = d.pages[0].nodes[0];
      first.svgColor = '#000000'; first.svgColorToken = 'accent';
      d.tokens.secondary = '#ff0066';
      d.pages[0].nodes.push({ ...first, id: 'svg-second', x: 200, svgColorToken: 'secondary' });
      d.pages[0].nodes.push({ ...first, id: 'svg-missing', x: 300, svgColor: '#447788', svgColorToken: 'missing' });
      window.design.setDocument(d); window.design.setSelection(['svg', 'svg-second', 'svg-missing']);
    });
    await page.getByRole('button', { name: 'Detach SVG color variable', exact: true }).click();
    assert.deepEqual((await doc()).pages[0].nodes.map(n => [n.svgColor, n.svgColorToken]), [
      ['#00ff00', undefined], ['#ff0066', undefined], ['#447788', undefined],
    ], 'Multi-selection detach preserves each SVG effective paint, including missing-token fallback');
    console.log('PASS SVG colors: actual shape pixels, variable propagation, independent background, detach, source, reload, export, restore');
    assert.deepEqual(errors, [], 'No uncaught renderer errors');
    console.log('PASS variable library: safe color creation, selection/undo, collision export error, malformed icon handling');
  } finally {
    try { await app?.close(); } finally { await fs.rm(profile, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
