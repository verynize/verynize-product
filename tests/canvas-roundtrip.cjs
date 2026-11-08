const { _electron } = require('@playwright/test');
const { waitForUiReady } = require('./helpers/ui-ready.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + '/bd-roundtrip-');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;env.VERYNIZE_SKIP_ONBOARDING='1';env.VERYNIZE_LAUNCH_EDITOR='1';
  const app = await _electron.launch({ timeout:20000, env, args: ['.', `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow({timeout:15000});
    await waitForUiReady(page);
    await page.waitForSelector('#canvas .layer');
    await page.evaluate(() => window.design.importHTML('<p style="font-size:24px;color:#222222">Hello <strong>bold <em style="color:#ff0000;font-size:36px">and red italic</em></strong><br>world</p>'));
    const text = await page.evaluate(() => window.design.getDocument().pages[0].nodes.at(-1));
    assert.equal(text.type, 'text');
    assert.equal(text.text, 'Hello bold and red italic\nworld');
    const red = text.textRuns.find(run => run.color === '#ff0000');
    assert.equal(red.bold, true); assert.equal(red.italic, true); assert.equal(red.fontSize, 36);
    assert.equal(text.text.slice(red.start, red.end), 'and red italic');
    const original = await page.evaluate(() => window.design.getDocument());
    const html = await page.evaluate(() => window.design.exportHTML());
    assert.ok(html.includes('verynize-document'));
    await page.evaluate(() => { const d = window.design.getDocument(); d.pages[0].nodes = []; window.design.setDocument(d); });
    await page.evaluate(html => window.design.importHTML(html), html);
    const recovered = await page.evaluate(() => window.design.getDocument());
    const withoutId = n => { const {id,parentId,...rest} = n; return rest; };
    assert.deepEqual(recovered.pages[0].nodes.map(withoutId), original.pages[0].nodes.map(withoutId));
    assert.equal(await page.locator('#canvas .layer').count(), original.pages[0].nodes.length);
    await page.evaluate(() => { const d=window.design.getDocument(); d.pages[0].nodes[0].text='</script><img src=x onerror=alert(1)>'; window.design.setDocument(d); });
    const escaped = await page.evaluate(() => window.design.exportHTML());
    assert.ok(escaped.includes('\\u003c/script>'));
    await page.evaluate(html => window.design.importHTML(html), escaped);
    for (const [width,height] of [[1440,950],[1000,700]]) {
      await app.evaluate(({BrowserWindow},{width,height}) => BrowserWindow.getAllWindows()[0].setSize(width,height), {width,height});
      await page.locator('#zoom-menu-button').click();await page.locator('#zoom-fit').click();
      const metrics = await page.evaluate(() => ({body:document.body.scrollWidth, viewport:innerWidth, canvas:document.querySelector('#canvas').getBoundingClientRect().width, workspace:document.querySelector('#workspace').clientWidth}));
      assert.ok(metrics.body <= metrics.viewport);
      assert.ok(metrics.canvas < metrics.workspace);
    }
    console.log('PASS: styled span import, lossless own HTML export/import, embedded JSON escaping, fitted 1440/1000 layouts');
  } finally { await app.close(); await fs.rm(profile,{recursive:true,force:true}); }
})().catch(error => { console.error(error); process.exitCode=1; });
