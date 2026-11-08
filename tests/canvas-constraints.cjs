// Constraints: CSS anchoring of positioned layers. Changing one never moves the layer; parent resizes follow it.
const {_electron} = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-constraints-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000}); await moveOffCursor(app);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    const node = id => page.evaluate(id => window.design.getDocument().pages[0].nodes.find(n => n.id === id), id);
    const near = (a, b, label, t = 0.6) => assert.ok(Math.abs(a - b) <= t, `${label}: ${a} ~= ${b}`);
    // Rendered box relative to the parent's padding box, in world units.
    const box = id => page.evaluate(id => {
      const el = document.querySelector(`#canvas [data-id="${id}"]`), p = el.parentElement.closest('.layer'), z = window.design.getCamera().zoom;
      const r = el.getBoundingClientRect(), q = p.getBoundingClientRect();
      return {x: (r.left - q.left) / z - p.clientLeft, y: (r.top - q.top) / z - p.clientTop, w: r.width / z, h: r.height / z};
    }, id);
    async function seed(nodes, select) {
      await page.evaluate(([nodes, select]) => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Desktop', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setSelection([select]); window.design.setTool('move'); window.design.setCamera(80, 80, 1);
      }, [nodes, select]);
    }
    const resizeParent = patch => page.evaluate(patch => window.design.updateNodes(['p'], patch), patch);
    const choose = async (axis, value) => { await page.locator(`#position-section select[name=${axis === 'h' ? 'constraintH' : 'constraintV'}]`).selectOption(value); };
    const parent = {id: 'p', name: 'Parent', type: 'frame', x: 0, y: 0, w: 400, h: 300, color: '#ffffff', layout: 'free', strokeWidth: 2, strokeColor: '#000000'};
    const child = {id: 'c', name: 'Child', type: 'rectangle', parentId: 'p', x: 300, y: 200, w: 80, h: 60, color: '#8844cc'};
    await seed([parent, child], 'c');

    // Defaults: Left / Top, Z Auto.
    assert.equal(await page.locator('#position-section select[name=constraintH]').inputValue(), 'start');
    assert.equal(await page.locator('#position-section select[name=constraintV]').inputValue(), 'start');
    assert.equal(await page.locator('#position-section [name=zIndex]').getAttribute('placeholder'), 'Auto', 'stack order shows Auto');
    const before = await box('c');

    // Right: pinned to the right edge, no visual change, parent width follows.
    await choose('h', 'end');
    let c = await node('c');
    assert.deepEqual(c.inset, [200, 16, null, null], 'right inset measured inside the 2px border: 396 - 300 - 80; top stays explicit');
    const right = await box('c'); near(right.x, before.x, 'choosing Right does not move the layer'); near(right.y, before.y, 'or vertically');
    await resizeParent({w: 500});
    near((await box('c')).x, 400, 'Right keeps the distance to the right edge when the parent grows');
    near((await node('c')).x, 400, 'x/y read back the anchored position');

    // Bottom.
    await choose('v', 'end');
    await resizeParent({h: 400});
    near((await box('c')).y, 300, 'Bottom follows the bottom edge');

    // Left & Right stretches.
    await choose('h', 'stretch');
    c = await node('c'); assert.equal(c.wMode, 'fill', 'Left & Right fills between both insets');
    near((await box('c')).w, 80, 'stretching does not resize at once');
    await resizeParent({w: 600});
    near((await box('c')).w, 180, 'Left & Right grows with the parent'); near((await node('c')).w, 180, 'w reads back');

    // Center keeps the offset from the centre.
    await choose('h', 'center');
    const centered = await box('c'); near(centered.x, 400, 'Center does not move the layer'); near(centered.w, 180, 'nor resize it');
    await resizeParent({w: 800});
    near((await box('c')).x, 500, 'Center keeps its offset from the parent centre');

    // Scale keeps proportions.
    await choose('h', 'scale');
    c = await node('c'); assert.equal(c.inset[3], '62.81%', 'scale stores a percentage of the 796px padding box'); assert.ok(c.wPct > 22 && c.wPct < 23);
    await resizeParent({w: 400});
    const scaled = await box('c'); near(scaled.x, 248.5, 'Scale moves proportionally', 1); near(scaled.w, 89.5, 'and resizes proportionally', 1);

    // Moving / nudging an anchored layer keeps its constraint.
    await page.evaluate(() => window.design.setSelection(['c']));
    await page.keyboard.press('ArrowRight');
    c = await node('c'); assert.equal(window_c(c), 'scale', 'nudging keeps Scale');
    near((await box('c')).x, scaled.x + 1, 'and moves by one pixel', 0.8);
    await page.keyboard.press(mod('z'));
    near((await box('c')).x, scaled.x, 'undo restores the position', 0.8);

    // Widget: click the left tick, shift-click the right tick → Left & Right.
    await page.locator('#position-section [data-constraint="h-start"]').click();
    assert.equal(await page.locator('#position-section select[name=constraintH]').inputValue(), 'start');
    await page.locator('#position-section [data-constraint="h-end"]').click({modifiers: ['Shift']});
    assert.equal(await page.locator('#position-section select[name=constraintH]').inputValue(), 'stretch', 'shift-click the opposite edge pins both');
    assert.equal(await page.locator('#position-section [data-constraint="h-start"]').getAttribute('aria-pressed'), 'true');

    // Canvas drag of an anchored layer keeps it anchored right after the move.
    await choose('h', 'end'); await choose('v', 'start');
    const b = await page.locator('#canvas [data-id=c]').boundingBox();
    await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.mouse.move(b.x - 30, b.y + 10, {steps: 6}); await page.mouse.up();
    c = await node('c'); assert.equal(c.inset[1] !== null && c.inset[3] === null, true, 'dragging keeps the Right constraint');
    const moved = await box('c');
    await resizeParent({w: 500});
    near((await box('c')).x, moved.x + 100, 'and the dragged layer still follows the right edge');

    // Canvas resize of the parent: a Right-pinned child follows the handle.
    await page.evaluate(() => window.design.setSelection(['p']));
    const se = await page.locator('#canvas [data-id=p] > .handle[data-corner=se]').boundingBox();
    const startX = (await box('c')).x;
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2); await page.mouse.down();
    await page.mouse.move(se.x + se.width / 2 + 50, se.y + se.height / 2, {steps: 5}); await page.mouse.up();
    near((await box('c')).x, startX + 50, 'resizing the parent on canvas carries Right-pinned children', 1);

    // Artboards and auto-layout children have no constraints.
    await page.evaluate(() => window.design.setSelection(['p']));
    assert.equal(await page.locator('#position-section select[name=constraintH]').isDisabled(), true, 'artboards have no constraints');
    await seed([{id: 's', name: 'Stack', type: 'frame', x: 0, y: 0, w: 300, h: 200, color: '#ffffff', layout: 'flex', direction: 'column', gap: 8, padding: 10},
      {id: 'k', name: 'k', type: 'rectangle', parentId: 's', x: 0, y: 0, w: 100, h: 40, color: '#8844cc'},
      {id: 'a', name: 'a', type: 'rectangle', parentId: 's', position: 'absolute', inset: [null, 10, 10, null], x: 0, y: 0, w: 50, h: 30, color: '#44aa88'}], 'k');
    assert.equal(await page.locator('#position-section select[name=constraintH]').isDisabled(), true, 'stack children have no constraints');
    await page.evaluate(() => window.design.setSelection(['a']));
    assert.equal(await page.locator('#position-section select[name=constraintH]').inputValue(), 'end', 'absolute children read their insets as constraints');
    assert.equal(await page.locator('#position-section select[name=constraintV]').inputValue(), 'end');
    await page.evaluate(() => window.design.updateNodes(['s'], {w: 400}));
    near((await box('a')).x, 400 - 10 - 50, 'absolute children of stacks follow too');
    // Multi-selection with different constraints reads Mixed.
    await seed([parent, child, {...child, id: 'd', name: 'd', inset: [10, null, null, null]}], 'c');
    await page.evaluate(() => window.design.setSelection(['c', 'd']));
    assert.equal(await page.locator('#position-section select[name=constraintH]').inputValue(), 'start');
    await page.evaluate(() => window.design.setConstraints(['d'], {v: 'end'}));
    await page.evaluate(() => window.design.setSelection(['c', 'd']));
    assert.equal(await page.locator('#position-section select[name=constraintV]').inputValue(), 'mixed', 'different constraints read Mixed');
    await choose('v', 'center');
    assert.deepEqual([(await node('c')).inset?.[0], (await node('d')).inset?.[0]], ['50%', '50%'], 'setting applies to every selected layer');

    assert.deepEqual(errors, []);
    console.log('PASS canvas constraints: Left/Right/Left & Right/Center/Scale + Top/Bottom without moving, parent resize (model + handle) re-anchors, nudge/drag/undo keep constraints, widget shift-click, artboard + stack children disabled, absolute stack children, Mixed');
  } finally { await app.close(); await fs.rm(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
function window_c(n) { return Array.isArray(n.inset) && typeof n.inset[3] === 'string' && n.inset[3].endsWith('%') && n.inset[3] !== '50%' ? 'scale' : 'other'; }
