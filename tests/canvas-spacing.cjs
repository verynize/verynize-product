// On-canvas spacing handles: drag padding and gaps of the selected auto-layout frame.
const {_electron} = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-spacing-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000}); await moveOffCursor(app);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    const node = id => page.evaluate(id => window.design.getDocument().pages[0].nodes.find(n => n.id === id), id);
    const rect = (id, parentId, extra = {}) => ({id, name: id, type: 'rectangle', parentId, x: 0, y: 0, w: 100, h: 50, color: '#8844cc', ...extra});
    async function seed(nodes, select) {
      await page.evaluate(([nodes, select]) => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Desktop', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setSelection([select]); window.design.setTool('move'); window.design.setCamera(100, 100, 1);
      }, [nodes, select]);
    }
    const frameCenter = id => page.locator(`#canvas [data-id="${id}"]`).boundingBox().then(b => ({x: b.x + b.width / 2, y: b.y + b.height / 2}));
    // Hover the selected frame so its spacing handles appear, then return the centre of the requested band.
    async function band(id, selector) {
      const c = await frameCenter(id); await page.mouse.move(c.x + 1, c.y + 1, {steps: 2});
      const b = await page.locator('#canvas-overlay ' + selector).first().boundingBox();
      assert.ok(b, 'band visible: ' + selector);
      return {x: b.x + b.width / 2, y: b.y + b.height / 2};
    }
    async function dragBy(from, dx, dy, modifiers = []) {
      await page.mouse.move(from.x, from.y); for (const m of modifiers) await page.keyboard.down(m);
      await page.mouse.down(); await page.mouse.move(from.x + dx, from.y + dy, {steps: 8});
      const badge = await page.locator('#canvas-overlay .spacing-band.active .spacing-badge').textContent().catch(() => null);
      await page.mouse.up(); for (const m of modifiers) await page.keyboard.up(m);
      return badge;
    }
    const stack = {id: 'stack', name: 'Stack', type: 'frame', x: 0, y: 0, w: 240, h: 200, color: '#ffffff', layout: 'flex', direction: 'column', gap: 16, padding: 24, wMode: 'fixed', hMode: 'hug'};
    await seed([stack, rect('a', 'stack'), rect('b', 'stack'), rect('c', 'stack')], 'stack');

    await band('stack', '.spacing-gap');
    assert.equal(await page.locator('#canvas-overlay').getAttribute('data-spacing'), '6', 'four padding bands and two gaps');
    assert.equal(await page.locator('#canvas-overlay .spacing-padding[data-side="2"]').evaluate(e => getComputedStyle(e).cursor), 'ns-resize');
    assert.equal(await page.locator('#canvas-overlay .spacing-gap').first().evaluate(e => getComputedStyle(e).cursor), 'row-resize');

    let badge = await dragBy(await band('stack', '.spacing-padding[data-side="2"]'), 0, 30); // hug height: the bottom edge follows the pointer down
    let s = await node('stack');
    assert.equal(badge, '54', 'live badge shows the value being dragged');
    assert.deepEqual([s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], [24, 24, 54, 24], 'bottom padding drag changes only the bottom side');
    assert.deepEqual([s.x, s.y], [0, 0], 'pressing a spacing handle does not move the frame');
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), ['stack'], 'the frame stays selected');
    await page.keyboard.press(mod('z'));
    s = await node('stack');
    assert.equal(s.paddingBottom, undefined, 'one undo restores the padding'); assert.equal(s.padding, 24);
    await dragBy(await band('stack', '.spacing-padding[data-side="1"]'), -12, 0); // fixed width: the inner edge follows the pointer left
    assert.equal((await node('stack')).paddingRight, 36, 'right padding on a fixed axis grows when dragged inward');
    await page.keyboard.press(mod('z'));

    await dragBy(await band('stack', '.spacing-padding[data-side="0"]'), 0, 10, ['Shift']);
    s = await node('stack');
    assert.equal(s.padding, 34, 'shift-drag sets all four sides'); assert.equal(s.paddingTop, undefined);

    await dragBy(await band('stack', '.spacing-padding[data-side="3"]'), 6, 0, ['Alt']);
    s = await node('stack');
    assert.deepEqual([s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], [34, 40, 34, 40], 'alt-drag mirrors the opposite side');

    await dragBy(await band('stack', '.spacing-gap'), 0, 10);
    assert.equal((await node('stack')).gap, 26, 'dragging a gap band changes the stack gap');

    // Grid: column gaps write gapX, row gaps gapY.
    const grid = {id: 'grid', name: 'Grid', type: 'frame', x: 0, y: 0, w: 300, h: 200, color: '#ffffff', layout: 'grid', columns: 2, gap: 20, padding: 10, wMode: 'fixed', hMode: 'hug'};
    await seed([grid, rect('g1', 'grid'), rect('g2', 'grid'), rect('g3', 'grid'), rect('g4', 'grid')], 'grid');
    await dragBy(await band('grid', '.spacing-gap[data-axis="x"]'), 10, 0);
    let g = await node('grid');
    assert.equal(g.gapX, 30, 'grid column gap'); assert.equal(g.gap, 20, 'row gap untouched');
    await dragBy(await band('grid', '.spacing-gap[data-axis="y"]'), 0, -8);
    assert.equal((await node('grid')).gapY, 12, 'grid row gap');

    // Space-between: the gap reads Auto and dragging it makes it fixed.
    const row = {id: 'row', name: 'Row', type: 'frame', x: 0, y: 0, w: 400, h: 80, color: '#ffffff', layout: 'flex', direction: 'row', gap: 0, padding: 0, justifyContent: 'space-between', wMode: 'fixed', hMode: 'fixed'};
    await seed([row, rect('r1', 'row'), rect('r2', 'row')], 'row');
    const auto = await band('row', '.spacing-gap');
    await page.mouse.move(auto.x, auto.y);
    assert.equal(await page.locator('#canvas-overlay .spacing-gap .spacing-badge').textContent(), 'Auto');
    await dragBy(auto, -100, 0);
    const r = await node('row');
    assert.equal(r.justifyContent, 'flex-start', 'dragging an auto gap fixes it'); assert.equal(r.gap, 100);

    // Drags stop where the layout would break: a 12-column grid gap counts eleven times and must not push cells out.
    const wide = {id: 'wide', name: 'Wide', type: 'frame', x: 0, y: 0, w: 600, h: 100, color: '#ffffff', layout: 'grid', columns: 12, gap: 8, padding: 0, wMode: 'fixed', hMode: 'hug'};
    await seed([wide, ...Array.from({length: 12}, (_, i) => rect('w' + i, 'wide', {w: 20, h: 20}))], 'wide');
    await dragBy(await band('wide', '.spacing-gap[data-axis="x"]'), 400, 0);
    const limited = await node('wide');
    assert.ok(limited.gapX > 8 && limited.gapX <= 34, 'the gap grows up to the space left (1px rounding) (' + limited.gapX + ')');
    assert.ok(await page.locator('#canvas [data-id=wide]').evaluate(e => Math.max(...[...e.querySelectorAll(':scope > .layer')].map(k => k.offsetLeft + k.offsetWidth)) <= e.clientWidth + 1.5), 'no cell is pushed outside the frame');
    // Text children are never squeezed below their longest word.
    const words = {id: 'words', name: 'Words', type: 'frame', x: 0, y: 0, w: 320, h: 80, color: '#ffffff', layout: 'flex', direction: 'row', gap: 8, padding: 0, wMode: 'fixed', hMode: 'hug'};
    const text = (id, t) => ({id, name: id, type: 'text', parentId: 'words', x: 0, y: 0, w: 100, h: 20, text: t, fontSize: 16, color: '#111111', wMode: 'hug', hMode: 'hug'});
    await seed([words, text('t1', 'Instrument Sans'), text('t2', 'JetBrains Mono')], 'words');
    const longest = await page.locator('#canvas [data-id=t1]').evaluate(e => { e.style.width = 'min-content'; e.style.overflowWrap = 'normal'; const w = e.offsetWidth; e.style.width = ''; e.style.overflowWrap = ''; return w; });
    await dragBy(await band('words', '.spacing-gap'), 400, 0);
    assert.ok((await page.locator('#canvas [data-id=t1]').evaluate(e => e.offsetWidth)) >= longest - 1, 'words are not broken apart by a gap drag');
    assert.ok((await node('words')).gap > 8, 'the gap still grew');

    // Handles only show for a selected auto-layout frame under the pointer.
    await page.evaluate(() => window.design.setSelection(['r1']));
    await page.mouse.move(auto.x + 3, auto.y + 3);
    assert.equal(await page.locator('#canvas-overlay .spacing-band').count(), 0, 'no handles for non-frame selections');
    assert.deepEqual(errors, []);
    console.log('PASS canvas spacing: padding per side + live badge, shift all sides, alt mirror, flex gap, grid gapX/gapY, auto gap, one-step undo, handles do not move the frame, drags stop before overflow or broken words');
  } finally { await app.close(); await fs.rm(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
