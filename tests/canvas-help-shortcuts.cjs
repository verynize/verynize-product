// Wonder canvas parity (design/wonder/canvas-audit): toolbar tool set (T1), zoom label menu (T6), `?` help menu (T5),
// keyboard shortcuts drawer (K1), ⌘K command palette and the Text tool defaults (TX1).
const {_electron} = require(process.cwd() + '/node_modules/@playwright/test');
const { MOD_LABEL, mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require('./helpers/ui-ready.cjs');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const nodes = [
  {id: 'dark', name: 'Dark', type: 'frame', x: 0, y: 0, w: 400, h: 300, color: '#111111', radius: 0, layout: 'free'},
  {id: 'light', name: 'Light', type: 'frame', x: 500, y: 0, w: 400, h: 300, color: '#ffffff', radius: 0, layout: 'free'},
];

(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + '/bd-help-'), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE; env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({timeout: 20000, env, args: ['.', `--user-data-dir=${profile}`, '--force-device-scale-factor=2']}); // 2×, as on a Retina Mac: text metrics below are measured at 2×
  try {
    const p = await app.firstWindow({timeout: 15000}); await moveOffCursor(app);
    await waitForUiReady(p);
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 870));
    await p.waitForSelector('#canvas .layer');
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    const seed = async () => {
      await p.evaluate(list => { const d = window.design.getDocument(); d.pages = [{id: 'p1', name: 'Page 1', nodes: list}]; d.activePage = 'p1'; window.design.setDocument(d); window.design.setSelection([]); window.design.setTool('move'); }, nodes);
      await p.waitForTimeout(200);
      await p.evaluate(() => window.design.zoomToFit());
      await p.waitForTimeout(200);
    };
    await seed();

    // ---- T1: Move, Scale, Hand | Frame, Shader, Text (+ Verynize's Pen), then the view toggles and `+`.
    const labels = await p.locator('#canvas-toolbar button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
    assert.deepEqual(labels, ['Move', 'Scale', 'Hand', 'Frame', 'Shader', 'Text', 'Pen', 'Find layers', 'Details layout', 'Design layout', 'Views']);
    assert.equal(await p.locator('#canvas-toolbar #eyedropper-tool, #eyedropper-tool:visible').count(), 0, 'no eyedropper button');
    assert.equal(await p.locator('#canvas-toolbar #add-ellipse, #add-ellipse:visible').count(), 0, 'no ellipse button');
    await p.keyboard.press('o');
    assert.equal(await p.evaluate(() => window.design.getTool()), 'ellipse', 'O still arms the ellipse tool');
    await p.keyboard.press('Escape');
    await p.evaluate(() => { window.EyeDropper = undefined; });
    await p.keyboard.press('i');
    assert.equal(await p.evaluate(() => window.design.getTool()), 'eyedropper', 'I still arms the eyedropper');
    await p.keyboard.press('Escape');
    await p.locator('#bd-view-menu-button').hover();
    await p.locator('[data-state=delayed-open]', {hasText: 'Save or choose a view'}).first().waitFor();
    await p.mouse.move(700, 300);
    // The toolbar Text button arms the tool instead of inserting a layer.
    const before = await p.evaluate(() => window.design.getDocument().pages[0].nodes.length);
    await p.locator('#text').click();
    assert.equal(await p.evaluate(() => window.design.getTool()), 'text');
    assert.equal(await p.locator('#text').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.evaluate(() => window.design.getDocument().pages[0].nodes.length), before, 'arming creates nothing');
    await p.locator('#text').click();
    assert.equal(await p.evaluate(() => window.design.getTool()), 'move');

    // ---- T6: the zoom label menu.
    await p.locator('#zoom-menu-button').click();
    const zoomItems = await p.locator('#bd-zoom-menu [role=menuitem]').evaluateAll(list => list.map(i => i.id));
    assert.deepEqual(zoomItems, ['zoom-50', 'zoom-reset', 'zoom-200', 'zoom-in', 'zoom-out', 'zoom-fit']);
    assert.equal(await p.locator('#bd-zoom-menu [role=separator]').count(), 1);
    assert.match(await p.locator('#zoom-in').innerText(), /Zoom in\s*⌘\+/);
    assert.equal(await p.locator('#bd-zoom-menu').getByText('Snap to objects').count(), 0);
    await p.locator('#zoom-200').click();
    assert.equal(await p.evaluate(() => window.design.getCamera().zoom), 2, 'Zoom to 200%');
    await p.locator('#zoom-menu-button').click(); await p.locator('#zoom-50').click();
    assert.equal(await p.evaluate(() => window.design.getCamera().zoom), 0.5, 'Zoom to 50%');
    assert.equal(parseInt(await p.locator('#zoom-reset').textContent()), 50, '#zoom-reset keeps the percentage');
    // Snap and saved views stay reachable (hidden proxies, palette, `+` menu).
    assert.equal(await p.locator('#snap').isChecked(), true);
    // Toolbar toggle: the on-screen layout stays highlighted while the view reads "Design · edited" (Wonder T1, T3,
    // T4, V3); the open views menu moves the highlight to `+` (T2-plus).
    assert.equal(await p.locator('#layout-design').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.locator('#layout-details').getAttribute('aria-pressed'), 'false');
    await p.locator('#bd-view-menu-button').click();
    await p.getByRole('menuitem', {name: 'Save current view'}).waitFor();
    assert.equal(await p.locator('#layout-design').getAttribute('aria-pressed'), 'false', 'the + takes the highlight while open');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelector('#layout-design')?.getAttribute('aria-pressed') === 'true');

    // ---- T5: the `?` help menu.
    await p.locator('#bd-canvas-help').click();
    const help = await p.locator('#bd-help-menu [role=menuitem]').evaluateAll(list => list.map(i => [i.textContent.trim(), i.hasAttribute('data-disabled')]));
    assert.deepEqual(help.map(h => h[0]), ['Docs', 'Keyboard shortcuts', 'Restart onboarding', 'Give feedback', 'Contact us', 'Discord community', 'Export diagnostic logs', "Verynize 0.18November 1", 'View all']);
    assert.deepEqual(help.filter(h => h[1]).map(h => h[0]), [], 'every help item is enabled (placeholder URLs in help-links.ts)');
    assert.equal(await p.locator('#bd-help-menu').getByText("What's new", {exact: true}).count(), 1);
    // What's new lists placeholder entries (title over date, two-line 44px rows like Wonder T5-help) before View all.
    const entry = p.locator('#bd-help-menu [data-whats-new]');
    assert.equal(await entry.count(), 1);
    assert.equal(await entry.evaluate(el => el.offsetHeight), 44);
    // Wonder R6-help-menu: 180px menu; labels start 34px in and end in an ellipsis at 112px beside ↗ ("Discord commu…")
    // or 128px without it ("Export diagnostic l…").
    const fit = await p.evaluate(async () => {
      await Promise.all(document.getElementById('bd-help-menu').getAnimations().map(a => a.finished)); // zoom-in-95
      const menu = document.getElementById('bd-help-menu').getBoundingClientRect();
      // Characters drawn before the ellipsis: the longest prefix whose width plus "…" fits the label box.
      const visible = span => {
        const probe = document.createElement('span'); // a sibling inherits the same font settings
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        span.after(probe);
        let n = span.textContent.length;
        if (span.scrollWidth > span.clientWidth) for (; n > 0; n--) { probe.textContent = span.textContent.slice(0, n) + '…'; if (probe.getBoundingClientRect().width <= span.clientWidth) break; }
        probe.remove(); return span.textContent.slice(0, n);
      };
      return {menu: menu.width, labels: [...document.querySelectorAll('#bd-help-menu [data-help-label]')].map(s => {
        const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
        return {id: s.closest('[role=menuitem]').id, left: r.left - menu.left, max: cs.maxWidth, overflow: cs.textOverflow, cut: s.scrollWidth > s.clientWidth, shown: visible(s)};
      })};
    });
    assert.equal(fit.menu, 180, 'help menu is 180px wide');
    for (const l of fit.labels) { assert.equal(l.overflow, 'ellipsis', l.id); assert.equal(l.left, 34, l.id + ' text starts 34px in'); }
    const label = id => fit.labels.find(l => l.id === id);
    assert.equal(label('help-discord').max, '112px'); assert.equal(label('help-diagnostics').max, '128px');
    assert.deepEqual(fit.labels.filter(l => l.cut).map(l => [l.id, l.shown]), [['help-discord', 'Discord commu'], ['help-diagnostics', 'Export diagnostic l']], 'only Discord and Export truncate, like Wonder');
    // Wonder T5-help What's new section (measured from the 2× capture): label 12px from 10px in; entries without
    // icons, 13px titles and 12px #a8a8a8 dates from 12px in, the title's line box 5.5px into the 44px row (cap top
    // 11px) with a 16.5px baseline step to the date; "View all" a 29px row of 13px text, also 12px in.
    const news = await p.evaluate(() => {
      const menu = document.getElementById('bd-help-menu').getBoundingClientRect();
      const text = el => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); return {left: r.left - menu.left, top: r.top, height: r.height}; };
      const label = [...document.querySelectorAll('#bd-help-menu [role=group] > *')].find(e => e.textContent === "What's new");
      const row = document.querySelector('#bd-help-menu [data-whats-new]'), rowTop = row.getBoundingClientRect().top;
      const title = row.querySelector('[data-whats-new-title]'), date = row.querySelector('[data-whats-new-date]'), all = document.getElementById('help-whats-new');
      const font = el => [getComputedStyle(el).fontSize, getComputedStyle(el).color];
      const lineTop = el => +(el.getBoundingClientRect().top - rowTop).toFixed(2), lineH = el => el.getBoundingClientRect().height;
      return {label: [text(label).left, getComputedStyle(label).fontSize, getComputedStyle(label).color], title: [text(title).left, ...font(title), lineTop(title), lineH(title)],
        date: [text(date).left, ...font(date), lineTop(date), lineH(date)], all: [text(all.querySelector('span')).left, getComputedStyle(all).fontSize, all.offsetHeight]};
    });
    assert.deepEqual(news.label, [10, '12px', 'rgb(150, 150, 150)'], "What's new label: 12px #969696 (T5-help, R6-help-menu)");
    assert.equal(await p.locator('#bd-help-menu [data-whats-new-title]').evaluate(e => e.scrollWidth <= e.clientWidth), true, 'the placeholder entry title is not truncated');
    assert.deepEqual(news.title, [12, '13px', 'rgb(232, 232, 232)', 5.5, 20], 'entry title: 13px, 12px in, line box 5.5px into the row');
    assert.deepEqual(news.date, [12, '12px', 'rgb(168, 168, 168)', 26.5, 12], 'entry date: 12px secondary grey below the title');
    assert.deepEqual(news.all, [12, '13px', 29], 'View all: 13px text in a 29px row');
    await p.locator('#help-onboarding').click();
    await p.locator('#onboarding').waitFor();
    await p.evaluate(() => { localStorage.setItem('verynize.onboarding', 'done'); });
    await p.reload(); await waitForUiReady(p); await p.waitForSelector('#canvas .layer'); await seed();
    assert.equal(await p.locator('#onboarding').count(), 0);

    // ---- K1: shortcut drawer from the help menu, searchable.
    await p.locator('#bd-canvas-help').click();
    await p.locator('#help-shortcuts').click();
    await p.locator('#shortcuts-drawer').waitFor();
    assert.equal(await p.locator('#shortcuts-search').getAttribute('placeholder'), 'Search shortcuts…');
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'shortcuts-search');
    const sections = await p.locator('#shortcuts-drawer [data-shortcut-section]').evaluateAll(list => list.map(s => s.dataset.shortcutSection));
    assert.deepEqual(sections, ['APPLICATION', 'TOOLS', 'EDIT', 'SELECTION', 'VIEW', 'TRANSFORM', 'COMPONENTS', 'ALIGNMENT', 'MOVEMENT', 'TEXT EDITING']);
    const row = label => p.locator(`#shortcuts-drawer [data-shortcut-section] [data-shortcut="${label}"]`);
    assert.equal((await row('Command palette').innerText()).replace(/\s+/g, ''), `Commandpalette${MOD_LABEL}K`);
    assert.equal((await row('Eye dropper (alt)').innerText()).replace(/\s+/g, ''), 'Eyedropper(alt)⌃C');
    assert.equal((await row('Zoom to 100%').innerText()).replace(/\s+/g, ''), 'Zoomto100%⇧0');
    assert.equal((await row('Frame selection (alt)').innerText()).replace(/\s+/g, ''), `Frameselection(alt)${MOD_LABEL}⌥G`);
    assert.equal(await p.locator('#shortcuts-drawer > div > [data-shortcut="Command palette"]').count(), 1, 'pinned palette row');
    await p.locator('#shortcuts-search').fill('zoom');
    const found = await p.locator('#shortcuts-drawer [data-shortcut-section] [data-shortcut]').evaluateAll(list => list.map(r => r.dataset.shortcut));
    assert.ok(found.length >= 5 && found.every(l => /zoom/i.test(l)), `search filters rows (${found})`);
    assert.equal(await p.locator('#shortcuts-drawer > div > [data-shortcut="Command palette"]').count(), 0);
    await p.locator('#shortcuts-search').fill('nothing like this');
    await p.locator('#shortcuts-drawer').getByText('No shortcuts found').waitFor();
    await p.keyboard.press('Escape'); // clears the query
    assert.equal(await p.locator('#shortcuts-search').inputValue(), '');
    await p.keyboard.press('Escape'); // closes
    await p.locator('#shortcuts-drawer').waitFor({state: 'detached'});

    // ---- ⌘K: command palette over the registry (no longer the Files screen).
    await p.mouse.click(700, 600);
    await p.keyboard.press(mod('KeyK'));
    await p.locator('[data-command-palette]').waitFor();
    assert.equal(await p.evaluate(() => document.body.classList.contains('files-view')), false, '⌘K does not open Files');
    await p.locator('[data-command-palette] [cmdk-input]').fill('select all');
    await p.locator('[data-command-id="select.all"]').waitFor();
    await p.keyboard.press('Enter');
    await p.locator('[data-command-palette]').waitFor({state: 'detached'});
    await p.waitForFunction(() => window.design.getSelection().length === 2);
    await p.keyboard.press(mod('KeyK'));
    await p.locator('[data-command-palette] [cmdk-input]').fill('keyboard shortcuts');
    await p.locator('[data-command-id="app.shortcuts"]').click();
    await p.locator('#shortcuts-drawer').waitFor();
    await p.locator('#shortcuts-drawer [aria-label="Close keyboard shortcuts"]').click();
    await p.locator('#shortcuts-drawer').waitFor({state: 'detached'});

    // ---- P2: Wonder's palette geometry, empty state (Recent, Application), sections, highlight, ↓, Esc.
    await p.evaluate(() => window.design.setSelection(['dark']));
    await p.keyboard.press(mod('KeyK'));
    const palette = p.locator('[data-command-palette]');
    await palette.waitFor();
    const paletteInput = p.locator('[data-command-palette] [cmdk-input]');
    assert.deepEqual(await palette.boundingBox(), {x: 384, y: 122, width: 672, height: 480}, 'Wonder: x384 y122 672 × 480');
    assert.equal(await paletteInput.getAttribute('placeholder'), 'Jump to or find anything...');
    assert.equal((await p.locator('[data-palette-input]').boundingBox()).height, 44, 'input strip 44px');
    assert.equal((await p.locator('[data-palette-footer]').boundingBox()).height, 38, 'footer 38px');
    assert.equal((await p.locator('[data-palette-footer]').innerText()).replace(/\s+/g, ''), 'Navigate↓↑Open↵CloseEsc');
    assert.equal(await palette.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '16px');
    assert.equal(await palette.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 24, 24)');
    const paletteSections = () => p.locator('[data-command-palette] [data-palette-section]:not([hidden])').evaluateAll(els => els.map(el => [el.dataset.paletteSection, [...el.querySelectorAll('[cmdk-item]:not([hidden])')].map(i => i.dataset.commandId)]));
    const activeRow = () => p.locator('[data-command-palette] [cmdk-item][data-selected=true]').getAttribute('data-command-id');
    assert.deepEqual(await paletteSections(), [['Recent', ['app.shortcuts', 'select.all']], ['Application', ['app.shortcuts', 'app.tour', 'app.feedback']]], 'Recent, then Application');
    assert.equal(await activeRow(), 'app.shortcuts', 'first row active');
    const firstRow = p.locator('[data-command-palette] [cmdk-item]').first();
    assert.equal((await firstRow.boundingBox()).height, 32, 'rows are 32px');
    assert.deepEqual(await firstRow.evaluate(el => { const r = el.getBoundingClientRect(); return [r.x, r.width, getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopLeftRadius]; }), [392, 656, 'rgb(41, 41, 41)', '8px'], 'active row x392 w656, rgb(41,41,41), radius 8');
    // Typed one key at a time (as a user does): the list must not keep an earlier query's scroll offset.
    await paletteInput.fill('');
    await paletteInput.pressSequentially('select', {delay: 40});
    await p.waitForTimeout(100);
    assert.ok(await p.evaluate(() => { const list = document.querySelector('[data-command-palette] [cmdk-list]'), row = list.querySelector('[cmdk-item][data-selected=true]'), a = list.getBoundingClientRect(), b = row.getBoundingClientRect(); return b.top >= a.top && b.bottom <= a.bottom; }), 'the active row stays visible while typing');
    let listed = await paletteSections();
    assert.deepEqual(listed.slice(0, 2).map(s => s[0]), ['Edit', 'Selection'], 'Wonder P2-select: Edit, then Selection');
    assert.deepEqual(listed[0][1].slice(0, 2), ['select.all', 'clipboard.pasteOverSelection']);
    assert.ok(listed.some(([title, ids]) => title === 'Workspace' && ids.includes('layout.details')), 'toolbar views match "select"');
    assert.equal(await activeRow(), 'select.all');
    assert.equal(await p.locator('[data-command-id="select.all"] .text-foreground-2').first().innerText(), 'Select', 'the match is highlighted');
    assert.equal((await p.locator('[data-command-id="select.all"] kbd').allInnerTexts()).join(''), `${MOD_LABEL}A`, 'keycaps');
    await p.keyboard.press('ArrowDown');
    assert.equal(await activeRow(), 'clipboard.pasteOverSelection', 'Wonder P2-keyboard-focused');
    await paletteInput.fill('dark');
    listed = await paletteSections();
    assert.deepEqual(listed[0], ['Layers', ['layer:dark']], 'layers come first');
    await p.locator('[data-command-palette] [aria-label="Clear search"]').click();
    assert.equal(await paletteInput.inputValue(), '');
    await p.keyboard.press('Escape');
    await palette.waitFor({state: 'detached'});
    assert.deepEqual(await p.evaluate(() => window.design.getSelection()), ['dark'], 'Esc keeps the selection');
    await p.keyboard.press(mod('KeyK'));
    await paletteInput.fill('light');
    await p.keyboard.press('Enter');
    await palette.waitFor({state: 'detached'});
    await p.waitForFunction(() => window.design.getSelection()[0] === 'light');
    console.log('PASS ⌘K palette: 672 × 480, Recent, sections, highlight, keyboard');
    // Files stays reachable from the title bar Search button.
    await p.locator('#shell-search').click();
    await p.waitForFunction(() => document.body.classList.contains('files-view'));
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.body.classList.contains('files-view'));

    // ---- TX1: Text tool click / drag defaults.
    await seed();
    const pt = (id, fx, fy) => p.evaluate(([id, fx, fy]) => { const r = document.querySelector(`#canvas [data-id="${id}"]`).getBoundingClientRect(); return {x: r.left + r.width * fx, y: r.top + r.height * fy}; }, [id, fx, fy]);
    const created = () => p.evaluate(() => window.design.getDocument().pages[0].nodes.filter(n => n.type === 'text'));
    const canUndo = () => p.evaluate(() => window.design.canUndo());
    const undoBefore = await canUndo();
    // Click on the light frame: empty Hug × Hug text in Inter Regular 12, black, editing.
    let at = await pt('light', 0.3, 0.3);
    await p.keyboard.press('t');
    await p.mouse.click(at.x, at.y);
    await p.locator('#canvas [data-text-editing]').waitFor();
    let [t] = await created();
    assert.deepEqual({name: t.name, text: t.text, parentId: t.parentId, wMode: t.wMode, hMode: t.hMode, fontFamily: t.fontFamily, fontWeight: t.fontWeight, fontSize: t.fontSize, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, color: t.color},
      {name: 'Text', text: '', parentId: 'light', wMode: 'hug', hMode: 'hug', fontFamily: 'Inter', fontWeight: '400', fontSize: 12, lineHeight: 'auto', letterSpacing: 0, color: '#000000'});
    assert.equal(await canUndo(), undoBefore, 'an empty draft is not an undo step');
    // Ending the edit with no content removes it.
    await p.keyboard.press('Escape');
    await p.locator('#canvas [data-text-editing]').waitFor({state: 'detached'});
    assert.equal((await created()).length, 0, 'empty text removed');
    assert.equal(await canUndo(), undoBefore);
    // Click on the dark frame: white ink; typed text commits as one undo step that removes the layer.
    at = await pt('dark', 0.3, 0.3);
    await p.keyboard.press('t');
    await p.mouse.click(at.x, at.y);
    await p.locator('#canvas [data-text-editing]').waitFor();
    assert.equal((await created())[0].color, '#ffffff', 'white on a dark background');
    await p.keyboard.type('Hello');
    await p.keyboard.press('Escape');
    await p.locator('#canvas [data-text-editing]').waitFor({state: 'detached'});
    [t] = await created();
    assert.equal(t.text, 'Hello');
    assert.ok(t.w > 10 && t.h > 10 && t.h < 20, `hug size measured (${t.w} × ${t.h})`);
    await p.evaluate(() => { document.activeElement?.blur?.(); });
    await p.keyboard.press(mod('KeyZ'));
    assert.equal((await created()).length, 0, 'one undo removes the new text');
    // Drag: a fixed box of the gesture size (zoom-independent world units).
    const zoom = await p.evaluate(() => window.design.getCamera().zoom);
    at = await pt('dark', 0.2, 0.2);
    await p.keyboard.press('t');
    await p.mouse.move(at.x, at.y); await p.mouse.down();
    await p.mouse.move(at.x + 150 * zoom, at.y + 60 * zoom, {steps: 6}); await p.mouse.up();
    await p.locator('#canvas [data-text-editing]').waitFor();
    [t] = await created();
    assert.deepEqual({w: t.w, h: t.h, wMode: t.wMode, hMode: t.hMode, text: t.text, fontSize: t.fontSize, color: t.color}, {w: 150, h: 60, wMode: 'fixed', hMode: 'fixed', text: '', fontSize: 12, color: '#ffffff'});
    await p.mouse.click(1000, 700); // pressing elsewhere ends editing: still empty → removed
    await p.waitForFunction(() => !window.design.getDocument().pages[0].nodes.some(n => n.type === 'text'));
    // Emptying an existing text layer in the editor removes it as one undo step.
    await p.evaluate(() => window.design.addNode('text', {text: 'Bye', x: 40, y: 40, parentId: 'dark'}));
    await p.keyboard.press('Enter');
    await p.locator('#canvas [data-text-editing]').waitFor();
    await p.keyboard.press(mod('KeyA')); await p.keyboard.press('Backspace'); await p.keyboard.press('Escape');
    await p.waitForFunction(() => !window.design.getDocument().pages[0].nodes.some(n => n.type === 'text'));
    await p.keyboard.press(mod('KeyZ'));
    assert.equal((await created())[0]?.text, 'Bye', 'undo restores the emptied layer');

    assert.deepEqual(errors, []);
    console.log('PASS help/shortcuts: toolbar tool set, zoom menu, help menu, shortcut drawer search, ⌘K palette, text click/drag defaults');
  } finally { await app.close(); await fs.rm(profile, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
