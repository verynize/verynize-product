// Canvas resize of a layer whose W/H is bound to a Dimension variable (Wonder behaviour): dragging the handle
// keeps the new size and detaches the binding of each changed axis, so later variable edits no longer move it.
// One undo restores both the size and the binding. Scale-tool resizes detach scaled child bindings too.
const { _electron } = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'bd-bound-resize-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  let app;
  try {
    app = await _electron.launch({ env, args: ['.', `--user-data-dir=${profile}`], timeout: 20000 });
    const page = await app.firstWindow({ timeout: 20000 }); await moveOffCursor(app);
    await page.waitForSelector('#canvas .layer');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const node = id => page.evaluate(id => window.design.getDocument().pages[0].nodes.find(n => n.id === id), id);
    const undo = () => page.evaluate(() => window.design.runCommand('edit.undo'));
    const seed = () => page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = {};
      d.variables = { 'size/card': { type: 'dimension', value: 200 }, 'size/tall': { type: 'dimension', value: 120 }, 'type/body': { type: 'dimension', value: 20 } };
      delete d.aliases;
      d.pages[0].nodes = [
        { id: 'card', name: 'Card', type: 'frame', x: 200, y: 160, w: 200, h: 120, color: '#334155', wMode: 'fixed', hMode: 'fixed', bindings: { w: 'size/card', h: 'size/tall' } },
        { id: 'label', name: 'Label', type: 'text', parentId: 'card', x: 10, y: 10, w: 120, h: 30, text: 'Hi', color: '#ffffff', fontSize: 20, bindings: { fontSize: 'type/body' } },
      ];
      window.design.setDocument(d);
      window.design.setSelection(['card']);
    });
    const drag = async (corner, dx, dy) => {
      const grip = page.locator(`#canvas [data-id=card] > .handle[data-corner=${corner}]`);
      const b = await grip.boundingBox();
      const zoom = await page.evaluate(() => window.design.getView().zoom);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + (dx * zoom) / 2, b.y + b.height / 2 + (dy * zoom) / 2, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2 + dx * zoom, b.y + b.height / 2 + dy * zoom, { steps: 3 });
      await page.mouse.up();
    };
    const setVariable = async (name, value) => {
      const panel = page.locator('#insp-variables');
      const header = panel.locator('button[aria-expanded]').first();
      if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
      const field = panel.getByRole('textbox', { name: `${name} value` });
      await field.fill(String(value));
      await field.press('Enter');
      await page.waitForFunction(([n, v]) => window.design.getDocument().variables[n].value === v, [name, value]);
    };

    await seed();
    await page.locator('#canvas [data-id=card] > .handle[data-corner=se]').waitFor();
    // Horizontal-only drag: W detaches, H keeps its binding.
    await drag('se', 60, 0);
    let card = await node('card');
    assert.equal(Math.round(card.w), 260, 'drag sets the new width');
    assert.equal(card.h, 120);
    assert.equal(card.bindings?.w, undefined, 'width binding detached by the canvas resize');
    assert.equal(card.bindings?.h, 'size/tall', 'unchanged axis keeps its binding');
    assert.equal(Math.round(Number.parseFloat(await page.locator('#canvas [data-id=card]').evaluate(el => el.style.width))), 260);
    // The variable no longer drives the width; the height still follows its variable.
    await setVariable('size/card', 300);
    await setVariable('size/tall', 150);
    card = await node('card');
    assert.equal(Math.round(card.w), 260, 'detached width ignores later variable edits');
    assert.equal(card.h, 150, 'bound height follows its variable');
    // Undo the two variable edits, then one undo restores the resized width and its binding together.
    await undo();
    await undo();
    assert.equal((await node('card')).h, 120);
    await undo();
    card = await node('card');
    assert.equal(card.w, 200, 'one undo restores the width');
    assert.deepEqual(card.bindings, { w: 'size/card', h: 'size/tall' }, 'the same undo restores the binding');

    // A diagonal drag detaches both axes.
    await drag('se', 40, 30);
    card = await node('card');
    assert.equal(card.bindings, undefined, 'both bindings detached');
    assert.equal(Math.round(card.w), 240);
    assert.equal(Math.round(card.h), 150);
    await undo();
    assert.deepEqual((await node('card')).bindings, { w: 'size/card', h: 'size/tall' });

    // Scale tool: the frame and its scaled children drop the bindings of scaled values.
    await page.evaluate(() => window.design.runCommand('tool.scale'));
    await drag('se', 100, 60);
    card = await node('card');
    const label = await node('label');
    assert.equal(card.bindings, undefined);
    assert.ok(label.fontSize > 20, 'scale grows the child type size');
    assert.equal(label.bindings, undefined, 'scaled child type size detached from its variable');
    await undo();
    assert.deepEqual((await node('label')).bindings, { fontSize: 'type/body' });
    assert.equal((await node('label')).fontSize, 20);
    await page.evaluate(() => window.design.runCommand('tool.move'));

    assert.deepEqual(errors, []);
    console.log('canvas bound resize: PASS');
  } finally {
    await app?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
