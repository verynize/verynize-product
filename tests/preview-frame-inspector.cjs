// Preview frame as a canvas object (preview audit PF4–PF7): default screen template, the Screen template inspector,
// the preview-only context menu (including Clear preview data with and without logins) and the layer row icon.
const {_electron} = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-frame-inspector-'));
  let loads = 0;
  const server = http.createServer((_request, response) => {
    loads++;
    response.setHeader('content-type', 'text/html');
    response.end('<h1>Preview data</h1><script>window.seed=()=>{localStorage.setItem("kept","local");sessionStorage.setItem("tab","session");document.cookie="login=yes; path=/; SameSite=None; Secure";};</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://localhost:${server.address().port}/`;
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${profile}`]});
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({width: 1440, height: 870});
    await page.waitForFunction(() => !!window.livePreview?.getSelectionState && !!window.previewPresets);

    // window.previewPresets: Wonder's order and sizes.
    const presets = await page.evaluate(() => window.previewPresets.map(p => `${p.name} ${p.w} × ${p.h}`));
    assert.deepEqual(presets, ['iPhone 17 402 × 874', 'iPhone 18 Pro 402 × 874', 'iPhone Air 420 × 912', 'iPhone 18 Pro Max 440 × 956', 'iPhone Duo Folded 466 × 678', 'iPhone Duo Open 626 × 890', 'iPad Air 11" 820 × 1180', 'iPad Mini 8.3" 744 × 1133', 'MacBook Air 1280 × 832', 'MacBook Pro 14" 1512 × 982', 'MacBook Pro 16" 1728 × 1117', 'Desktop 1920 × 1080', 'TV 3840 × 2160']);

    // PF4: a new preview frame is MacBook Pro 14" (1512 × 982) and the selection badge says so.
    await page.evaluate(url => window.livePreview.show(url), url);
    const choose = async name => {
      await page.locator('#screen-template-menu').waitFor({state: 'detached'});
      await page.locator('#screen-template').click();
      await page.locator('#screen-template-menu').waitFor();
      await page.waitForTimeout(200);
      await page.locator('#screen-template-menu').locator(`[data-preset='${name}']`).click();
      await page.locator('#screen-template-menu').waitFor({state: 'detached'});
    };
    const node = () => page.evaluate(() => window.design.getDocument().pages.flatMap(p => p.nodes).find(n => n.preview));
    let frame = await node();
    assert.equal(frame.w, 1512); assert.equal(frame.h, 982);
    assert.equal(frame.preview.template, 'MacBook Pro 14"');
    await page.waitForFunction(() => /1512\s*[x×]\s*982/.test(document.querySelector('#canvas-overlay')?.textContent || ''));

    // PF6: preview inspector sections, in order, without the ordinary frame sections.
    const sections = await page.$$eval('#insp-properties section[id]:not([hidden])', list => list.map(s => s.id));
    assert.deepEqual(sections.filter(id => id !== 'layer-commands'), ['screen-template-section', 'position-section', 'layout-section', 'appearance-section', 'export-section']);
    for (const name of ['radius', 'clipContent']) assert.equal(await page.locator(`#properties [name=${name}]`).count(), 0, name + ' hidden for previews');
    assert.equal(await page.locator('#properties .insp-display').count(), 0, 'no Display / auto layout');
    assert.equal(await page.locator('#screen-template').textContent(), 'MacBook Pro 14"');
    assert.equal(await page.locator('#properties [name=w]').inputValue(), '1512');
    assert.equal(await page.locator('#screen-template-rotate').getAttribute('aria-label'), 'Rotate to portrait');

    // Choosing a template resizes the viewport (the app reflows inside the iframe).
    await page.locator('#screen-template').click();
    const items = await page.locator('#screen-template-menu [data-preset]').allTextContents();
    assert.equal(items.length, 13);
    assert.match(items[0], /^iPhone 17\s*402 × 874/);
    // Layout sizes (offsetWidth/Height ignore the open animation's scale).
    assert.equal(await page.locator('#screen-template-menu').evaluate(el => el.offsetWidth), 224);
    assert.equal(await page.locator('#screen-template-menu [data-preset="iPhone 17"]').evaluate(el => el.offsetHeight), 24);
    await page.waitForTimeout(300);
    await page.screenshot({path: '/tmp/preview-frame-presets.png'});
    await page.locator('#screen-template-menu [data-preset="iPhone 17"]').click();
    await page.locator('#screen-template-menu').waitFor({state: 'detached'});
    frame = await node();
    assert.deepEqual([frame.w, frame.h, frame.preview.template], [402, 874, 'iPhone 17']);
    assert.equal(await page.locator('#screen-template').textContent(), 'iPhone 17');
    const viewport = page.frames().find(f => f.name() === 'verynize-live-preview');
    await viewport.waitForFunction(() => innerWidth < 500);
    // iPhone 18 Pro has the same size: the stored template keeps it apart from iPhone 17.
    await choose('iPhone 18 Pro');
    assert.equal(await page.locator('#screen-template').textContent(), 'iPhone 18 Pro');
    // Rotate swaps W/H and flips the label.
    assert.equal(await page.locator('#screen-template-rotate').getAttribute('aria-label'), 'Rotate to landscape');
    await page.locator('#screen-template-rotate').click();
    frame = await node();
    assert.deepEqual([frame.w, frame.h], [874, 402]);
    assert.equal(await page.locator('#screen-template-rotate').getAttribute('aria-label'), 'Rotate to portrait');
    assert.equal(await page.locator('#screen-template').textContent(), 'iPhone 18 Pro');
    // A size that matches no template reads Custom.
    await page.locator('#properties [name=w]').fill('900');
    await page.locator('#properties [name=w]').press('Enter');
    await page.waitForFunction(() => document.getElementById('screen-template')?.textContent === 'Custom');
    // Aspect lock scales the other axis.
    await page.locator('#preview-aspect-lock').click();
    await page.locator('#properties [name=w]').fill('1800');
    await page.locator('#properties [name=w]').press('Enter');
    frame = await node();
    assert.deepEqual([frame.w, frame.h], [1800, 804]);
    await page.locator('#preview-aspect-lock').click();
    await choose('MacBook Pro 14"');
    frame = await node();
    assert.deepEqual([frame.w, frame.h], [1512, 982]);

    // The template persists and validates in the headless store too.
    const {validateDocument} = await import('../integrations/design-store.mjs');
    const saved = validateDocument(await page.evaluate(() => JSON.parse(JSON.stringify(window.design.getDocument()))));
    assert.equal(saved.pages.flatMap(p => p.nodes).find(n => n.preview).preview.template, 'MacBook Pro 14"');
    assert.throws(() => validateDocument({...saved, pages: saved.pages.map(p => ({...p, nodes: p.nodes.map(n => n.preview ? {...n, preview: {...n.preview, template: 5}} : n)}))}), /Invalid preview configuration/);

    // PF7: the layer row is a browser window, and captured layers stay siblings.
    const row = page.locator(`#layer-panel [data-layer-id="${frame.id}"], #layer-panel [data-id="${frame.id}"]`).first();
    await row.waitFor();
    assert.ok(await row.locator('svg.lucide-app-window').count(), 'browser-window icon');

    // PF5: the preview context menu.
    const box = await page.locator('#live-frame').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {button: 'right'});
    const menu = page.locator('#canvas-menu[data-target=preview]');
    await menu.waitFor();
    const labels = await menu.evaluate(el => [...el.children].map(c => c.getAttribute('role') === 'separator' ? '|' : [...c.querySelectorAll('span')].map(s => s.textContent).filter(Boolean).join(' ') + (c.hasAttribute('data-disabled') ? ' [disabled]' : '')));
    const paste = labels[5].endsWith('[disabled]') ? ' [disabled]' : ''; // Paste follows the in-app clipboard.
    assert.deepEqual(labels, ['Copy ⌘C [disabled]', 'Copy as [disabled]', 'Copy link to selection', '|', 'Select layer', 'Paste ⌘V' + paste, 'Paste styles ⌘⌥V' + paste, 'Paste to replace ⌘⇧R' + paste, 'Paste over selection ⌘⇧V' + paste, 'Duplicate ⌘D [disabled]', '|', 'Hide ⌘⇧H', 'Lock ⌘⇧L', '|', 'Arrange', 'Show terminal' + labels[15].slice(13), 'Clear preview data', 'Clear preview data (including logins)', '|', 'Layout', '|', 'Set as file thumbnail [disabled]']);
    // Wonder: 176 px; Inter is a little wider, so the menu takes its widest whole row (see context-menu.css).
    const menuWidth = await menu.evaluate(el => el.offsetWidth);
    assert.ok(menuWidth >= 176 && menuWidth <= 186, 'preview menu ≈176 px wide, got ' + menuWidth);
    const clipped = await menu.evaluate(el => [...el.querySelectorAll('[role=menuitem] > span:first-child')].filter(s => s.scrollWidth > s.offsetWidth).map(s => s.textContent));
    assert.deepEqual(clipped, ['Clear preview data (including logins)'], 'only the logins label truncates');
    await page.waitForTimeout(300);
    await page.screenshot({path: '/tmp/preview-frame-context.png'});
    await page.keyboard.press('Escape');

    // Clear preview data keeps cookies; the "including logins" variant clears them too. Both reload the frame.
    const live = () => page.frames().find(f => f.name() === 'verynize-live-preview');
    // The reload can still be committing when `load` resolves on the old document (slow software rendering on
    // Linux CI), so a read that lands mid-navigation retries on the new document.
    const read = async () => {
      for (let i = 0; ; i++) {
        try { return await live().evaluate(() => ({local: localStorage.getItem('kept'), session: sessionStorage.getItem('tab'), cookie: document.cookie})); }
        catch (e) { if (i >= 20 || !/context was destroyed|detached/i.test(e.message)) throw e; await new Promise(r => setTimeout(r, 100)); }
      }
    };
    await live().evaluate(() => window.seed());
    assert.deepEqual(await read(), {local: 'local', session: 'session', cookie: 'login=yes'});
    const clear = async label => {
      const before = loads;
      const b = await page.locator('#live-frame').boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, {button: 'right'});
      await menu.waitFor();
      await menu.getByRole('menuitem', {name: label, exact: true}).click();
      await page.waitForFunction(() => true);
      for (let i = 0; i < 50 && loads === before; i++) await new Promise(r => setTimeout(r, 100));
      assert.ok(loads > before, label + ' reloads the preview');
      await live().waitForLoadState('load');
    };
    await clear('Clear preview data');
    assert.deepEqual(await read(), {local: null, session: null, cookie: 'login=yes'});
    await live().evaluate(() => window.seed());
    await clear('Clear preview data (including logins)');
    assert.deepEqual(await read(), {local: null, session: null, cookie: ''});

    // The IPC refuses anything but a localhost URL.
    const refused = await page.evaluate(async () => { try { await window.desktop.previewClearData({url: 'https://example.com', logins: true}); } catch (e) { return e.message; } });
    assert.match(refused, /localhost/);

    // An ordinary frame keeps the regular frame inspector.
    await page.evaluate(() => { const id = window.design.addNode('frame', {name: 'Plain', parentId: null, x: -2000, y: 0, w: 200, h: 200}); window.design.setSelection([id]); });
    await page.locator('#fill-section:not([hidden])').waitFor();
    assert.equal(await page.locator('#screen-template-section').count(), 0);
    assert.equal(await page.locator('#properties [name=radius]').count(), 1);
    console.log('PASS preview frame default template, Screen template inspector, rotate/custom/aspect, preview context menu, clear data, layer icon');
  } finally {
    await app.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
