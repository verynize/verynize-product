// Target-dependent context menus (Wonder canvas audit CM1–CM10): empty canvas, frame, text, multi-selection, locked
// and hidden layers, the artboard label, layer rows and page rows; the submenus; Show/Unlock labels; Paste disabled
// until something is copied; the menu paints above the selection badge.
const {_electron} = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

const FRAME_MENU = ['Add context', '|', 'Copy', 'Copy as', 'Copy link to selection', '|', 'Select layer', 'Paste', 'Paste to replace', 'Paste over selection', 'Duplicate', '|', 'Hide', 'Lock', 'Version history', 'Hide label', '|', 'Arrange', '|', 'Layout', '|', 'Set as file thumbnail'];
const without = (list, ...drop) => list.filter(x => !drop.includes(x));

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-context-menu-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000}); await moveOffCursor(app);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    await page.waitForSelector('#bd-layer-tree');
    const activeNodes = () => page.evaluate(() => { const d = window.design.getDocument(); return d.pages.find(p => p.id === d.activePage).nodes; });
    const node = async id => (await activeNodes()).find(n => n.id === id);
    const selection = () => page.evaluate(() => window.design.getSelection().toSorted());
    const frame = (id, x, y, w, h, extra = {}) => ({id, name: id, type: 'frame', x, y, w, h, color: '#ffffff', layout: 'free', ...extra});
    const rect = (id, x, y, w, h, extra = {}) => ({id, name: id, type: 'rectangle', x, y, w, h, color: '#8844cc', ...extra});
    const text = (id, x, y, extra = {}) => ({id, name: id, type: 'text', x, y, w: 160, h: 40, text: 'Hello', fontSize: 20, color: '#111111', ...extra});
    async function seed(nodes, pages = 1) {
      await page.keyboard.press('Escape');
      await page.evaluate(([nodes, pages]) => {
        const d = window.design.getDocument();
        d.pages = [{id: 'p1', name: 'Page 1', nodes}, ...(pages > 1 ? [{id: 'p2', name: 'Page 2', nodes: []}] : [])]; d.activePage = 'p1';
        window.design.setDocument(d); window.design.setSelection([]); window.design.setTool('move'); window.design.setCamera(80, 80, 1);
      }, [nodes, pages]);
      await page.waitForTimeout(150);
    }
    const FIXTURE = [
      frame('art', 0, 0, 600, 400),
      text('title', 40, 40, {parentId: 'art'}),
      rect('a', 40, 200, 100, 80, {parentId: 'art'}),
      rect('b', 200, 200, 100, 80, {parentId: 'art'}),
      rect('lockedBox', 360, 200, 100, 80, {parentId: 'art', locked: true}),
      rect('ghost', 40, 320, 100, 40, {parentId: 'art', hidden: true}),
      frame('side', 700, 0, 200, 200),
    ];
    // Menu rows in order: label text, '|' for separators.
    const items = (selector = '#canvas-menu') => page.locator(selector).evaluate(menu => [...menu.querySelectorAll('[role=menuitem], [role=separator]')]
      .map(el => el.getAttribute('role') === 'separator' ? '|' : el.querySelector('span').textContent.trim()));
    const item = (command, scope = '[data-bd-context-menu]') => page.locator(`${scope} [data-command="${command}"]`).first();
    const disabled = command => item(command).evaluate(el => el.hasAttribute('data-disabled'));
    const at = async (id, fx = 0.5, fy = 0.5) => { const r = await page.locator(`#canvas [data-id="${id}"]`).boundingBox(); return {x: r.x + r.width * fx, y: r.y + r.height * fy}; };
    const rightClick = async ({x, y}) => { await page.mouse.click(x, y, {button: 'right'}); await page.waitForSelector('#canvas-menu'); };
    const close = async () => { await page.keyboard.press('Escape'); await page.waitForSelector('[data-bd-context-menu]', {state: 'detached'}); };
    // Radix keeps the previous submenu open while the pointer may be heading into it, so nudge the pointer again.
    const openSub = async command => {
      const sub = page.locator(`[data-submenu="${command}"]`);
      const b = await item(command).boundingBox();
      for (let i = 0; i < 10 && !(await sub.isVisible()); i++) { await page.mouse.move(b.x + 20 + i, b.y + b.height / 2); await page.waitForTimeout(120); }
      await sub.waitFor();
    };

    await seed(FIXTURE);

    // CM1: empty canvas.
    const canvasBox = await page.locator('#canvas-wrap').boundingBox();
    const empty = {x: canvasBox.x + canvasBox.width - 60, y: canvasBox.y + canvasBox.height - 120};
    await rightClick(empty);
    assert.deepEqual(await items(), ['Select all', '|', 'Paste here', '|', 'Hide left sidebar', 'Hide right sidebar'], 'empty-canvas menu');
    assert.equal(await page.locator('#canvas-menu').getAttribute('data-target'), 'canvas');
    assert.equal(await disabled('clipboard.pasteHere'), true, 'Paste here is listed but disabled with nothing to paste');
    await item('view.toggleLeftSidebar').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('left-collapsed')), true, 'Hide left sidebar collapses the sidebar');
    await rightClick(empty);
    assert.equal((await items())[4], 'Show left sidebar', 'the sidebar item follows the panel state');
    await item('view.toggleLeftSidebar').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('left-collapsed')), false);
    await rightClick(empty);
    await item('select.all').click();
    assert.deepEqual(await selection(), ['art', 'side'], 'Select all');
    await page.evaluate(() => window.design.setSelection([]));

    // CM2: a frame. Right-click its background selects it; the menu is the frame menu, with Paste disabled.
    await rightClick(await at('art', 0.9, 0.9));
    assert.deepEqual(await selection(), ['art']);
    assert.deepEqual(await items(), FRAME_MENU, 'frame menu order');
    assert.equal(await page.locator('#canvas-menu').getAttribute('data-target'), 'layer');
    for (const command of ['edit.paste', 'clipboard.pasteToReplace', 'clipboard.pasteOverSelection']) assert.equal(await disabled(command), true, command + ' disabled with nothing copied');
    assert.equal(await disabled('edit.copy'), false);
    await close();
    // The menu paints above the selection size badge: open it just above the badge so the two overlap, then hit-test
    // the badge centre (the badge ignores the pointer, so let it take hits for the check).
    const badge = await page.locator('#selection-measure').boundingBox();
    const artBox = await page.locator('#canvas [data-id="art"]').boundingBox();
    await rightClick({x: badge.x + 2, y: artBox.y + artBox.height - 3});
    assert.deepEqual(await selection(), ['art']);
    const covered = await page.evaluate(([x, y]) => { const m = document.getElementById('selection-measure'); m.style.pointerEvents = 'auto'; const hit = document.elementFromPoint(x, y); m.style.pointerEvents = 'none'; return !!hit?.closest('#canvas-menu'); }, [badge.x + badge.width / 2, badge.y + badge.height / 2]);
    assert.ok(covered, 'the menu paints over the selection badge');
    await openSub('menu.copyAs');
    assert.deepEqual(await items('[data-submenu="menu.copyAs"]'), ['Copy as code', 'Copy as PNG', 'Copy prompt', 'Copy styles']);
    await openSub('menu.arrange');
    assert.deepEqual(await items('[data-submenu="menu.arrange"]'), ['Bring to front', 'Bring forward', 'Send backward', 'Send to back', '|', 'Flip horizontal', 'Flip vertical']);
    await openSub('menu.layout');
    assert.deepEqual(await items('[data-submenu="menu.layout"]'), ['Frame selection', 'Create component', 'Add auto layout']);
    await openSub('menu.selectLayer');
    assert.deepEqual(await items('[data-submenu="menu.selectLayer"]'), ['art'], 'Select layer lists the layers under the pointer');
    await close();

    // Select layer: the stack under the pointer, top-most first; picking one selects it.
    await page.evaluate(() => window.design.setSelection([]));
    await rightClick(await at('a'));
    assert.deepEqual(await selection(), ['a'], 'right-click on a child of an artboard selects the child');
    await openSub('menu.selectLayer');
    assert.deepEqual(await items('[data-submenu="menu.selectLayer"]'), ['a', 'art']);
    await item('menu.selectLayer.art').click();
    assert.deepEqual(await selection(), ['art'], 'picking a layer selects it');

    // CM4: with the frame selected, right-click targets the child under the pointer (clickTarget).
    await rightClick(await at('b'));
    assert.deepEqual(await selection(), ['b'], 'right-click drills into the selected frame');
    // A submenu action: Bring to front.
    await openSub('menu.arrange');
    await item('arrange.front').click();
    const order = (await activeNodes()).filter(n => n.parentId === 'art').map(n => n.id);
    assert.equal(order.at(-1), 'b', 'Bring to front moves the layer to the top: ' + order);

    // CM3: text, the frame menu without Hide label.
    await rightClick(await at('title'));
    assert.deepEqual(await selection(), ['title']);
    assert.deepEqual(await items(), without(FRAME_MENU, 'Version history', 'Hide label'), 'text menu order');
    await close();

    // CM5: multi-selection keeps the selection; no Copy link to selection, no Hide label for children.
    await page.evaluate(() => window.design.setSelection(['a', 'b']));
    await rightClick(await at('b'));
    assert.deepEqual(await selection(), ['a', 'b'], 'right-click inside a multi-selection keeps it');
    // Two siblings: Use as mask follows Layout (Wonder CM5-multi-verified, P5-mask-menu).
    { const multi = without(FRAME_MENU, 'Copy link to selection', 'Version history', 'Hide label'); multi.splice(multi.lastIndexOf('|'), 0, 'Use as mask'); assert.deepEqual(await items(), multi, 'multi-selection menu order (Use as mask after Layout, before Set as file thumbnail)'); }
    await close();

    // CM6: a locked layer is targeted although it is not hit-tested; its menu says Unlock.
    await page.evaluate(() => window.design.setSelection([]));
    await rightClick(await at('lockedBox'));
    assert.deepEqual(await selection(), ['lockedBox'], 'right-click targets the locked layer');
    assert.deepEqual((await items()).slice(12, 14), ['Hide', 'Unlock']);
    await item('layer.lock').click();
    assert.equal((await node('lockedBox')).locked, undefined, 'Unlock unlocks');

    // CM7: layer row, the frame menu without Select layer and its separator. A hidden layer says Show.
    await page.evaluate(() => window.design.setSelection([]));
    await page.locator('#bd-layer-tree .layer-row[data-id="art"]').click({button: 'right'});
    assert.deepEqual(await selection(), ['art'], 'right-click on a row selects its layer');
    assert.deepEqual(await items('[data-bd-context-menu][data-target=row]'), without(FRAME_MENU, 'Select layer').filter((x, i, list) => !(x === '|' && list[i + 1] === 'Paste')), 'row menu order');
    await close();
    if (!(await page.locator('#bd-layer-tree .layer-row[data-id="ghost"]').count())) await page.locator('#bd-layer-tree .layer-row[data-id="art"] button[aria-label^="Expand"]').click();
    await page.locator('#bd-layer-tree .layer-row[data-id="ghost"]').click({button: 'right'});
    assert.deepEqual(await selection(), ['ghost']);
    assert.deepEqual((await items('[data-bd-context-menu][data-target=row]')).slice(10, 12), ['Show', 'Lock'], 'hidden layer: Show');
    await item('layer.visibility').click();
    assert.equal((await node('ghost')).hidden, undefined, 'Show shows the layer');

    // CM9: the artboard label selects the frame and opens the frame menu; Hide label hides it.
    await page.evaluate(() => window.design.setSelection([]));
    const label = page.locator('#canvas-overlay .frame-label', {hasText: 'side'});
    const labelBox = await label.boundingBox();
    await rightClick({x: labelBox.x + 6, y: labelBox.y + labelBox.height / 2});
    assert.deepEqual(await selection(), ['side'], 'the label selects its frame');
    // Wonder CM9-label: the row menu (no Select layer; Copy link to selection is followed directly by Paste).
    const ROW_MENU = without(FRAME_MENU, 'Select layer').filter((x, i, list) => !(x === '|' && list[i + 1] === 'Paste'));
    assert.deepEqual(await items(), ROW_MENU, 'label menu has no Select layer');
    await item('menu.hideLabel').click();
    assert.equal((await node('side')).labelHidden, true, 'Hide label');
    await page.evaluate(() => window.design.setSelection([]));
    assert.equal(await page.locator('#canvas-overlay .frame-label', {hasText: 'side'}).count(), 0, 'the label is gone');
    await rightClick(await at('side'));
    assert.equal((await items())[15], 'Show label');
    await item('menu.hideLabel').click();
    assert.equal((await node('side')).labelHidden, undefined, 'Show label');

    // CM10: after a copy, Paste is enabled and pastes.
    await page.evaluate(() => window.design.setSelection(['a']));
    await page.evaluate(() => window.design.runCommand('edit.copy'));
    await rightClick(await at('a'));
    assert.equal(await disabled('edit.paste'), false, 'Paste is enabled once layers are copied');
    assert.ok(!(await items()).includes('Paste styles'), 'no Paste styles before Copy styles (Wonder CM2/CM5/CM10)');
    await close();
    // Paste styles ⌘⌥V follows Paste once styles are copied (Wonder P3-inside-menu, P5-mask-menu).
    await page.evaluate(() => window.design.runCommand('edit.copyStyle'));
    await rightClick(await at('a'));
    { const list = await items(); assert.deepEqual(list.slice(list.indexOf('Paste'), list.indexOf('Paste') + 3), ['Paste', 'Paste styles', 'Paste to replace'], 'Paste styles after Paste'); }
    assert.equal(await page.locator('[data-bd-context-menu] [data-command="edit.pasteStyle"]').first().textContent().then(t => t.includes('⌘⌥V')), true, 'Paste styles shortcut');
    const before = (await activeNodes()).length;
    await item('edit.paste').click();
    await page.waitForTimeout(100);
    assert.equal((await activeNodes()).length, before + 1, 'Paste pastes');

    // ⌘L / Add context adds the selection to the chat.
    await page.evaluate(() => window.design.setSelection([]));
    await rightClick(await at('title'));
    assert.deepEqual(await selection(), ['title']);
    await item('menu.addContext').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('agent-chat-open')), true, 'Add context opens the chat');
    assert.ok(await page.evaluate(() => window.agentWorkspace.getState().mentions.some(m => m.id === 'title')), 'the layer is a chat mention');
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await page.evaluate(() => window.design.setSelection(['b']));
    await page.locator('#canvas-wrap').hover();
    await page.keyboard.press(mod('KeyL'));
    assert.equal(await page.evaluate(() => document.body.classList.contains('agent-chat-open')), true, '⌘L adds context');
    await page.evaluate(() => window.agentWorkspace.closeChat());

    // CM8: page row, Rename F2 | Delete (disabled on the last page).
    await page.locator('[data-page-id="p1"]').click({button: 'right'});
    assert.deepEqual(await items('[data-bd-context-menu][data-target=page]'), ['Rename', '|', 'Delete']);
    assert.equal(await disabled('page.delete'), true, 'the only page cannot be deleted');
    // Wonder R3-delete-hover: label and delete-key glyph in a solid muted red, rgb(132,69,68).
    assert.deepEqual(await item('page.delete').evaluate(el => [getComputedStyle(el).color, getComputedStyle(el.querySelector('svg')).color]),
      ['rgb(132, 69, 68)', 'rgb(132, 69, 68)'], 'disabled Delete is muted red');
    await close();
    await seed(FIXTURE, 2);
    await page.locator('[data-page-id="p2"]').click({button: 'right'});
    assert.equal(await disabled('page.delete'), false);
    assert.notEqual(await item('page.delete').evaluate(el => getComputedStyle(el).color), 'rgb(132, 69, 68)', 'an enabled Delete keeps the full red');
    await item('page.delete').click();
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.design.getDocument().pages.map(p => p.id)), ['p1'], 'Delete removes the page');

    assert.deepEqual(errors, []);
    console.log('PASS canvas context menus: empty / frame / text / multi / locked / hidden / label / row / page menus in Wonder order, submenus, Select layer, Show/Unlock/Show label, paste state, z-order');
  } finally { await app.close(); await fs.rm(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
