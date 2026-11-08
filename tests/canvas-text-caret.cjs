// Custom text caret (Wonder TX1-click, TX1-drag, R7): 1.5 screen px wide at any zoom, one line tall (scales with zoom), black on a
// light background and white on a dark one, blinking, hidden for a range selection, during IME composition and when
// editing ends. The editor's native caret is transparent.
const {_electron} = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-text-caret-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000}); await moveOffCursor(app);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ~= ${expected}`);
    async function seed(nodes) {
      await page.evaluate(nodes => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Page 1', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setSelection([]); window.design.setTool('move'); window.design.setCamera(100, 100, 1);
      }, nodes);
    }
    async function screen(x, y) {
      return page.evaluate(([x, y]) => {
        const r = document.querySelector('#canvas-wrap').getBoundingClientRect(), c = window.design.getCamera();
        return {x: r.left + c.x + x * c.zoom, y: r.top + c.y + y * c.zoom};
      }, [x, y]);
    }
    const frameNode = {id: 'board', name: 'board', type: 'frame', x: 0, y: 0, w: 400, h: 300, color: '#ffffff', layout: 'free'};
    const editor = page.locator('#canvas [data-text-editing]');
    const caret = () => page.evaluate(() => {
      const c = document.querySelector('#canvas-overlay .text-caret');
      if (!c || c.hidden || !c.isConnected) return null;
      const r = c.getBoundingClientRect(), a = c.getAnimations()[0]?.effect?.getComputedTiming();
      return {x: r.x, y: r.y, w: r.width, h: r.height, color: getComputedStyle(c).backgroundColor, blink: a ? [a.duration, a.iterations] : null};
    });
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // The end of the editor's text on screen (the native caret position after typing).
    const textEnd = () => editor.evaluate(e => {
      const r = document.createRange(); r.selectNodeContents(e); const rects = [...r.getClientRects()], last = rects.at(-1);
      return {x: last.right, y: last.top, h: last.height, top: rects[0].top};
    });

    // ---- TX1-click: empty text on the white frame: a black 1.5 × 14.5 caret at the text's left edge ----
    await seed([frameNode]);
    const p = await screen(59, 160);
    await page.evaluate(() => window.design.setTool('text'));
    await page.mouse.click(p.x, p.y);
    await editor.waitFor(); await settle();
    assert.equal(await editor.evaluate(e => getComputedStyle(e).caretColor), 'rgba(0, 0, 0, 0)', 'the native caret is transparent');
    assert.equal(await editor.evaluate(e => document.activeElement === e && getSelection().isCollapsed && e.contains(getSelection().anchorNode)), true, 'the editor keeps focus and its native selection');
    let c = await caret();
    assert.ok(c, 'a caret is drawn on an empty text layer');
    near(c.w, 1.5, 0.01, 'caret width at 100 %'); near(c.h, 14.5, 0.6, 'caret height (one Inter 12 line)');
    near(c.x, p.x, 1, 'caret at the text left edge'); near(c.y, p.y, 1, 'caret at the line top');
    assert.equal(c.color, 'rgb(0, 0, 0)', 'black on the white frame');
    assert.deepEqual(c.blink, [1000, Infinity], 'blinks on a 1 s cycle');

    // ---- It follows typing ----
    await page.keyboard.type('Hello'); await settle();
    c = await caret(); let end = await textEnd();
    near(c.x, end.x, 1, 'caret after the typed text'); near(c.y, end.y, 1, 'on the text line'); near(c.h, end.h, 0.5, 'line tall');
    assert.ok(c.x > p.x + 20, 'caret moved right while typing');
    await page.keyboard.press('ArrowLeft'); await settle();
    const back = await caret();
    assert.ok(back.x < c.x - 2, 'caret follows arrow keys');
    await page.keyboard.press('ArrowRight'); // back to the end (End scrolls on macOS)

    // ---- Zoom scales it like the text; panning moves it ----
    await page.evaluate(() => window.design.setCamera(100, 100, 2)); await settle();
    c = await caret(); end = await textEnd();
    near(c.w, 1.5, 0.01, 'caret width stays 1.5 px at 200 % (Wonder R7)'); near(c.h, 29, 1.2, 'caret height scales with the zoom'); near(c.h, end.h, 0.5, 'caret height at 200 %'); near(c.x, end.x, 1, 'caret x at 200 %');
    await page.evaluate(() => window.design.setCamera(160, 130, 2)); await settle();
    const panned = await caret(); end = await textEnd();
    near(panned.x, end.x, 1, 'caret follows a pan (x)'); near(panned.y, end.y, 1, 'caret follows a pan (y)'); near(panned.x - c.x, 60, 1, 'pan delta');
    await page.evaluate(() => window.design.setCamera(100, 100, 1)); await settle();

    // ---- A range selection hides it ----
    await page.keyboard.press('Shift+ArrowLeft'); await settle();
    assert.equal(await caret(), null, 'no caret over a range selection');
    await page.keyboard.press('ArrowRight'); await settle();
    assert.ok(await caret(), 'the caret returns when the selection collapses');

    // ---- IME composition: no caret over the composition text ----
    await editor.evaluate(e => e.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}))); await settle();
    assert.equal(await caret(), null, 'hidden while composing');
    await editor.evaluate(e => e.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data: ''}))); await settle();
    assert.ok(await caret(), 'back after composition');

    // ---- Editing ends: the caret goes ----
    await page.keyboard.press('Escape'); await editor.waitFor({state: 'detached'}); await settle();
    assert.equal(await caret(), null, 'no caret once editing ends');

    // ---- TX1-drag on the dark page: white caret; it wraps with the text in a fixed box ----
    const q = await screen(515, 47);
    await page.evaluate(() => window.design.setTool('text'));
    await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x + 80, q.y + 60, {steps: 6}); await page.mouse.up();
    await editor.waitFor(); await settle();
    c = await caret();
    assert.ok(c, 'caret in an empty drag box');
    assert.equal(c.color, 'rgb(255, 255, 255)', 'white on the dark canvas');
    near(c.w, 1.5, 0.01, 'width'); near(c.x, q.x, 1, 'drag box left edge'); near(c.y, q.y, 1, 'drag box top');
    await page.keyboard.type('wrap wrap wrap wrap'); await settle();
    c = await caret(); end = await textEnd();
    assert.ok(end.y > end.top + 5, 'the text wrapped');
    near(c.y, end.y, 1, 'caret on the wrapped line'); near(c.x, end.x, 1, 'at the end of the wrapped line');
    await page.keyboard.press('Escape'); await editor.waitFor({state: 'detached'}); await settle();
    assert.equal(await caret(), null, 'gone after the second edit');

    assert.deepEqual(errors, []);
    console.log('PASS canvas text caret: 1.5 px Wonder caret, ink colour, follows typing/zoom/pan/wraps, hidden for ranges, IME and after editing');
  } finally {
    await app.close();
    await fs.rm(dir, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exit(1); });
