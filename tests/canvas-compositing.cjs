// Canvas compositing: the camera layer is promoted only while panning, so zooming out of a large document never runs
// Chromium out of tile memory ("tile memory limits exceeded, some content may not draw"). The GPU budget is lowered so
// the failure shows up on any machine, as it does on a laptop under memory pressure.
const {_electron} = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-compositing-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`, '--force-gpu-mem-available-mb=256'], timeout: 20000});
  let warnings = 0;
  app.process().stderr.on('data', d => { warnings += (String(d).match(/tile memory limits exceeded/g) || []).length; });
  const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
  try {
    const page = await app.firstWindow({timeout: 20000}); await moveOffCursor(app);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    if (process.env.FORCE_PROMOTED) await page.addStyleTag({content: '#canvas{will-change:transform!important}'}); // the pre-fix behaviour
    // Four long artboards of nested stacks, like a portfolio page and its design-token sheets.
    await page.evaluate(() => {
      const nodes = [];
      for (let f = 0; f < 4; f++) {
        const fid = 'f' + f;
        nodes.push({id: fid, name: 'Artboard ' + f, type: 'frame', x: f * 1600, y: 0, w: 1440, h: 4000, color: '#f5f5f5', layout: 'flex', direction: 'column', gap: 24, padding: 80, wMode: 'fixed', hMode: 'hug'});
        for (let s = 0; s < 12; s++) {
          const sid = fid + 's' + s;
          nodes.push({id: sid, name: 'Section', type: 'frame', parentId: fid, x: 0, y: 0, w: 1280, h: 300, color: '#ffffff', layout: 'flex', direction: 'row', gap: 16, padding: 24, wMode: 'fill', hMode: 'hug', radius: 8});
          for (let k = 0; k < 4; k++) nodes.push({id: sid + 't' + k, name: 'Text', type: 'text', parentId: sid, x: 0, y: 0, w: 280, h: 200, text: 'Heading text lorem ipsum ' + k, fontSize: 48, color: '#111111', wMode: 'fill', hMode: 'hug'});
        }
      }
      const d = window.design.getDocument();
      d.pages = [{id: d.pages[0].id, name: 'Desktop', nodes}]; d.activePage = d.pages[0].id;
      window.design.setDocument(d); window.design.setSelection([]); window.design.setCamera(-200, -200, 2);
    });
    await settle(1200);
    const promoted = () => page.locator('#canvas').evaluate(e => getComputedStyle(e).willChange);
    if (!process.env.FORCE_PROMOTED) assert.equal(await promoted(), 'auto', 'the camera layer is not promoted at rest');
    // Zoom out from 200% with the wheel (cursor-anchored, like a trackpad pinch), then pan.
    const r = await page.locator('#canvas-wrap').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.keyboard.down('Control');
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 40);
    await page.keyboard.up('Control');
    await settle();
    await page.mouse.wheel(0, 150);
    const duringPan = await promoted();
    for (let i = 0; i < 15; i++) await page.mouse.wheel(0, 150);
    await settle();
    if (!process.env.FORCE_PROMOTED) {
      assert.equal(duringPan, 'transform', 'panning promotes the camera layer');
      assert.equal(await promoted(), 'auto', 'the layer is released once the camera settles');
    }
    assert.equal(warnings, 0, `zooming out of a large document stays within tile memory (${warnings} warnings)`);

    // The reported case: at 25%, dragging a stack child inside a wide 12-column grid (live reorder + spacing overlays).
    // With the camera layer frozen at a larger raster scale this blanked whole tiles of the canvas and the app chrome.
    await page.evaluate(() => {
      const nodes = window.design.getDocument().pages[0].nodes, grid = {id: 'grid', name: 'Type scale', type: 'frame', parentId: 'f0', x: 0, y: 0, w: 1280, h: 1800, color: '#ffffff', layout: 'grid', columns: 12, gap: 40, padding: 80, wMode: 'fill', hMode: 'hug'};
      const cells = [0, 1].flatMap(c => [{id: 'cell' + c, name: 'Frame', type: 'frame', parentId: 'grid', x: 0, y: 0, w: 500, h: 1600, color: '#fafafa', layout: 'flex', direction: 'column', gap: 24, padding: 16, wMode: 'fill', hMode: 'hug', colSpan: 6},
        ...Array.from({length: 12}, (_, k) => ({id: `cell${c}t${k}`, name: 'Text', type: 'text', parentId: 'cell' + c, x: 0, y: 0, w: 400, h: 120, text: 'Eco Hero paham produk ' + k, fontSize: 32 + k * 8, color: '#111111', wMode: 'fill', hMode: 'hug'}))]);
      const d = window.design.getDocument(); d.pages[0].nodes = [...nodes, grid, ...cells];
      window.design.setDocument(d); window.design.setCamera(40, 40, 1); window.design.setCamera(40, 40, 0.25); window.design.setSelection(['cell0']);
    });
    await settle();
    const before = warnings, cell = await page.locator('#canvas [data-id=cell0]').boundingBox(), x = cell.x + cell.width / 2, y = cell.y + 60;
    await page.mouse.move(x, y, {steps: 4}); await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(x + Math.sin(i / 6) * 160, y + Math.cos(i / 9) * 120);
    await page.mouse.up(); await settle();
    assert.equal(warnings - before, 0, `dragging a stack child at 25% stays within tile memory (${warnings - before} warnings)`);
    assert.deepEqual(errors, []);
    console.log('PASS canvas compositing: no tile-memory exhaustion on zoom out or when dragging inside a wide grid at 25%, layer promoted only while panning');
  } finally { await app.close(); await fs.rm(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
