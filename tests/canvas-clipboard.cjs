// Wonder K2 / TR6 clipboard placement: Paste here, Paste to replace ⌘⇧R, Paste over selection ⌘⇧V, Copy link to
// selection, Copy prompt ⌘⇧⌥C, the Copy as code / Copy styles / Paste styles shortcuts, ⌘D's offset (to the right with
// a 40 px gap) and the next free name for duplicates and Alt-drag copies (web/clipboard-commands.js).
const {_electron} = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-clipboard-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000}); await moveOffCursor(app);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    const nodesOf = () => page.evaluate(() => window.design.getDocument().pages[0].nodes);
    const node = async id => (await nodesOf()).find(n => n.id === id);
    const selection = () => page.evaluate(() => window.design.getSelection());
    const run = (id, arg) => page.evaluate(([id, arg]) => window.design.runCommand(id, arg), [id, arg]);
    const readClipboard = () => app.evaluate(({clipboard}) => clipboard.readText());
    const clearClipboard = () => app.evaluate(({clipboard}) => clipboard.writeText(''));
    async function seed(nodes, select = []) {
      await page.evaluate(([nodes, select]) => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Desktop', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setSelection(select); window.design.setTool('move');
        window.design.setCamera(100, 300, 1);
      }, [nodes, select]);
    }
    async function screen(x, y) {
      return page.evaluate(([x, y]) => {
        const r = document.querySelector('#canvas-wrap').getBoundingClientRect(), c = window.design.getCamera();
        return {x: r.left + c.x + x * c.zoom, y: r.top + c.y + y * c.zoom};
      }, [x, y]);
    }
    const frame = (id, name, x, y, w = 120, h = 120, extra = {}) => ({id, name, type: 'frame', x, y, w, h, color: '#f26605', radius: 0, layout: 'free', ...extra});
    const rect = (id, x, y, w = 100, h = 80, extra = {}) => ({id, name: id, type: 'rectangle', x, y, w, h, color: '#8844cc', ...extra});

    // ---- Registry: ids, labels and Wonder's shortcuts ----
    const commands = await page.evaluate(() => window.design.commands());
    const keysOf = id => commands.find(c => c.id === id)?.keys || [];
    for (const id of ['clipboard.pasteHere', 'clipboard.pasteToReplace', 'clipboard.pasteOverSelection', 'clipboard.copyLink', 'clipboard.copyPrompt']) assert.ok(commands.some(c => c.id === id), id);
    assert.deepEqual(keysOf('clipboard.pasteToReplace'), ['mod+shift+r']);
    assert.deepEqual(keysOf('clipboard.pasteOverSelection'), ['mod+shift+v']);
    assert.deepEqual(keysOf('clipboard.copyPrompt'), ['mod+alt+shift+c']);
    assert.deepEqual(keysOf('edit.copyCode'), ['mod+shift+c']);
    assert.deepEqual(keysOf('edit.copyStyle'), ['mod+alt+c']);
    assert.deepEqual(keysOf('edit.pasteStyle'), ['mod+alt+v']);
    assert.ok(!keysOf('edit.pasteInPlace').includes('mod+shift+v'), 'Paste in place no longer owns ⌘⇧V');
    assert.equal(commands.find(c => c.id === 'edit.copyStyle').label, 'Copy styles');
    assert.equal(commands.find(c => c.id === 'edit.pasteStyle').label, 'Paste styles');
    console.log('PASS clipboard commands are registered with Wonder shortcuts');

    // ---- K2 ⌘D: to the right of the original with a 40 px gap, Y unchanged, next free name, stacked above ----
    await seed([frame('big', 'Frame', 0, 0, 420, 390), frame('a', 'Frame', 515, -133), rect('top', 900, 0)], ['a']);
    await page.keyboard.press(mod('KeyD'));
    let list = await nodesOf();
    let copy = list[2];
    assert.equal(list.length, 4);
    assert.equal(list[1].id, 'a', 'original stays'); assert.notEqual(copy.id, 'a');
    assert.equal(copy.x, 675, 'Wonder: 120 wide at X515 → X675'); assert.equal(copy.y, -133, 'Y unchanged');
    assert.equal(copy.name, 'Frame 2', 'next free name');
    assert.deepEqual(await selection(), [copy.id], 'the copy is selected');
    await page.keyboard.press(mod('KeyD'));
    list = await nodesOf();
    assert.equal(list[3].x, 835); assert.equal(list[3].name, 'Frame 3');
    await page.keyboard.press(mod('KeyZ'));
    assert.equal((await nodesOf()).length, 4, 'one undo step per duplicate');
    // Children: same parent, offset inside it; auto-layout children slot in after the original.
    await seed([frame('box', 'Box', 0, 0, 600, 400), rect('kid', 20, 30, 100, 50, {parentId: 'box'}), frame('stack', 'Stack', 0, 500, 400, 120, {layout: 'flex', gap: 10, padding: 10}), rect('s1', 0, 0, 60, 60, {parentId: 'stack'}), rect('s2', 0, 0, 60, 60, {parentId: 'stack'})], ['kid']);
    await run('edit.duplicate');
    list = await nodesOf();
    copy = list.find(n => n.name === 'kid 2');
    assert.ok(copy, 'child copy named kid 2'); assert.equal(copy.parentId, 'box'); assert.equal(copy.x, 160); assert.equal(copy.y, 30);
    await page.evaluate(() => window.design.setSelection(['s1']));
    await run('edit.duplicate');
    list = (await nodesOf()).filter(n => n.parentId === 'stack').map(n => n.name);
    assert.deepEqual(list, ['s1', 's1 2', 's2'], 'stack copy goes right after the original');
    console.log('PASS ⌘D offsets right by width + 40, keeps Y, renames to the next free name');

    // ---- TR6: Alt-drag copy gets the next free name ----
    await seed([frame('a', 'Frame', 0, 0), frame('b', 'Frame 2', 300, 0)], ['a']);
    const from = await screen(60, 60), to = await screen(160, 210);
    await page.mouse.move(from.x, from.y); await page.keyboard.down('Alt'); await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 8}); await page.mouse.up(); await page.keyboard.up('Alt');
    list = await nodesOf();
    assert.equal(list.length, 3, 'Alt-drag duplicates');
    copy = list.find(n => !['a', 'b'].includes(n.id));
    assert.equal(copy.name, 'Frame 3', 'Wonder TR6: the copy is Frame 3');
    assert.deepEqual([(await node('a')).x, (await node('a')).y], [0, 0], 'original stays');
    assert.deepEqual([copy.x, copy.y], [100, 150], 'copy moved by the gesture');
    console.log('PASS Alt-drag copy is named Frame 3');

    // ---- Paste here: top-left of the pasted bounds at the given document point, top level ----
    await seed([frame('host', 'Host', 0, 0, 600, 400), rect('p1', 20, 40, 100, 80, {parentId: 'host'}), rect('p2', 160, 60, 50, 50, {parentId: 'host'})], ['p1', 'p2']);
    await page.keyboard.press(mod('KeyC'));
    assert.equal(await run('clipboard.pasteHere', {x: 1000, y: 700}), true);
    list = await nodesOf();
    const here = list.slice(-2);
    assert.deepEqual(here.map(n => [n.x, n.y, n.parentId]), [[1000, 700, null], [1140, 720, null]], 'bounds top-left at the point, offsets kept');
    assert.deepEqual((await selection()).toSorted(), here.map(n => n.id).toSorted());
    await page.keyboard.press(mod('KeyZ'));
    assert.equal((await nodesOf()).length, 3, 'paste here is one undo step');
    console.log('PASS Paste here pastes at the point');

    // ---- ⌘⇧V Paste over selection: same parent, on top of the selection, centred on it ----
    await seed([rect('src', 2000, 0, 100, 80, {color: '#ff0000'}), frame('host', 'Host', 0, 0, 600, 400), rect('t', 100, 100, 200, 120, {parentId: 'host'}), rect('above', 400, 300, 50, 50, {parentId: 'host'})], ['src']);
    await page.keyboard.press(mod('KeyC'));
    await page.evaluate(() => window.design.setSelection(['t']));
    await page.keyboard.press(mod('Shift+KeyV'));
    list = await nodesOf();
    assert.equal(list.length, 5);
    const over = list[3];
    assert.equal(over.color, '#ff0000'); assert.equal(over.parentId, 'host', 'into the selection parent');
    assert.deepEqual([over.x, over.y], [150, 120], 'centred on the selection');
    assert.deepEqual(list.filter(n => n.parentId === 'host').map(n => n.id), ['t', over.id, 'above'], 'stacked just above the selection');
    assert.deepEqual(await selection(), [over.id]);
    // Nothing selected: paste in place.
    await page.evaluate(() => window.design.setSelection([]));
    await page.keyboard.press(mod('Shift+KeyV'));
    await page.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 6);
    const inPlace = (await nodesOf()).at(-1); assert.deepEqual([inPlace.x, inPlace.y, inPlace.parentId], [2000, 0, null]);
    console.log('PASS ⌘⇧V pastes over the selection');

    // ---- ⌘⇧R Paste to replace: each selected layer becomes the clipboard, same parent, position and slot ----
    await seed([rect('src', 2000, 0, 90, 90, {color: '#00ff00'}), frame('host', 'Host', 0, 0, 600, 400), rect('r1', 30, 40, 200, 120, {parentId: 'host'}), rect('keep', 300, 40, 50, 50, {parentId: 'host'}), rect('r2', 700, 500, 60, 60)], ['src']);
    await page.keyboard.press(mod('KeyC'));
    await page.evaluate(() => window.design.setSelection(['r1', 'r2']));
    await page.keyboard.press(mod('Shift+KeyR'));
    list = await nodesOf();
    assert.ok(!list.some(n => n.id === 'r1' || n.id === 'r2'), 'replaced layers are gone');
    const inHost = list.filter(n => n.parentId === 'host');
    assert.equal(inHost.length, 2); assert.equal(inHost[1].id, 'keep', 'the copy takes the replaced slot');
    assert.deepEqual([inHost[0].x, inHost[0].y, inHost[0].color], [30, 40, '#00ff00']);
    const topCopy = list.find(n => !n.parentId && n.id !== 'src' && n.id !== 'host');
    assert.deepEqual([topCopy.x, topCopy.y], [700, 500]);
    assert.deepEqual((await selection()).toSorted(), [inHost[0].id, topCopy.id].toSorted());
    await page.keyboard.press(mod('KeyZ'));
    assert.deepEqual((await nodesOf()).map(n => n.id), ['src', 'host', 'r1', 'keep', 'r2'], 'one undo step restores');
    console.log('PASS ⌘⇧R replaces each selected layer');

    // ---- Menu Paste (layer context menu): into the selected frame, centred (Wonder P3-context-paste-result) ----
    await seed([rect('src', 2000, 0, 100, 100, {color: '#ffffff'}), frame('target', 'Target', 0, 0, 300, 300), rect('inside', 10, 10, 20, 20, {parentId: 'target'})], ['src']);
    await page.keyboard.press(mod('KeyC'));
    await page.evaluate(() => window.design.setSelection(['target']));
    const targetAt = await screen(250, 250);
    await page.mouse.click(targetAt.x, targetAt.y, {button: 'right'});
    await page.waitForSelector('#canvas-menu');
    await page.locator('[data-bd-context-menu] [data-command="edit.paste"]').first().click();
    await page.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 4);
    list = await nodesOf();
    const child = list.at(-1);
    assert.equal(child.parentId, 'target', 'a child of the targeted frame');
    assert.deepEqual([child.x, child.y, child.w, child.h], [100, 100, 100, 100], 'Wonder: W100 H100 X100 Y100 in a 300 × 300 frame');
    assert.deepEqual(list.filter(n => n.parentId === 'target').map(n => n.id), ['inside', child.id], 'on top of the frame\'s children');
    assert.deepEqual(await selection(), [child.id]);
    await page.keyboard.press(mod('KeyZ'));
    assert.equal((await nodesOf()).length, 3, 'menu Paste is one undo step');
    // Not a frame: the canvas paste (same parent rules as ⌘V).
    await page.evaluate(() => window.design.setSelection(['inside']));
    assert.equal(await run('edit.paste', {menu: true}), true);
    assert.equal((await nodesOf()).at(-1).parentId, null, 'a rectangle target keeps the canvas paste');
    console.log('PASS menu Paste centres the clipboard inside the selected frame');

    // ---- Copy link to selection: verynize://node/<document>/<page>/<short id>, one per line, opens the layer again ----
    await seed([frame('art', 'Landing', 0, 0, 600, 400), rect('cta', 20, 20, 100, 40, {parentId: 'art'}), {id: 'label', name: 'Canvas au', type: 'text', text: 'Canvas au', x: 59, y: 160, w: 60, h: 15, fontFamily: 'Inter', fontSize: 12, color: '#000000', parentId: 'art'}], ['cta']);
    await clearClipboard();
    assert.equal(await run('clipboard.copyLink'), true);
    const pageId = (await page.evaluate(() => window.design.getDocument().activePage));
    const linkPattern = `verynize://node/[^/\\s]+/${encodeURIComponent(pageId)}/[a-z]{3,4}(?:\\.[a-z]{3,4})*`;
    const link = await readClipboard();
    assert.match(link, new RegExp(`^${linkPattern}$`), link);
    await page.evaluate(() => window.design.setSelection([]));
    assert.equal(await page.evaluate(l => window.agentWorkspace.openLink(l), link), true);
    assert.deepEqual(await selection(), ['cta'], 'the link resolves to the layer');
    await page.evaluate(() => window.design.setSelection(['cta', 'label']));
    await run('clipboard.copyLink');
    assert.match(await readClipboard(), new RegExp(`^${linkPattern}\\n${linkPattern}$`), 'one link per line');
    console.log('PASS Copy link to selection:', link);

    // ---- ⌘⇧⌥C Copy prompt: Wonder's sections (P1-copy-prompt*.txt) with Verynize links and MCP tools ----
    async function copiedPrompt(ids, blocks) {
      await page.evaluate(ids => window.design.setSelection(ids), ids);
      await clearClipboard();
      await page.keyboard.press(mod('Shift+Alt+KeyC'));
      let text = '';
      for (let i = 0; i < 80 && (text.match(/```tsx/g) || []).length < blocks; i++) { await page.waitForTimeout(100); text = await readClipboard(); }
      return text;
    }
    const lines = text => text.split('\n');
    function assertPrompt(text, count) {
      const all = lines(text);
      assert.equal(all[0], 'Implement this Verynize design.');
      assert.equal(all[1], '');
      assert.equal(all[2], 'Design to implement (each link ends in the Verynize page id and the element id: verynize://node/<document>/<pageId>/<elementId>):');
      for (let i = 0; i < count; i++) assert.match(all[3 + i], new RegExp(`^  ${linkPattern}$`), 'link ' + i);
      assert.match(all[3 + count], /^ {2}Read each element through the Verynize MCP server: get_element_code with that pageId and element id/);
      assert.match(all[4 + count], /^ {2}\(If you don't have the Verynize MCP installed yet, see .*docs\/figcraft-reference\.md/);
      assert.equal(all[5 + count], '');
      assert.match(all[6 + count], /^Inline snapshot \(fallback, captured at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\):$/);
      assert.equal((text.match(/^```tsx\n\/\*\*\n \* Made with Verynize\n \* verynize:\/\/node\/[^\n]+\n \* [A-Z][a-z]{2} \d{1,2}, \d{4}\n \*\/\n/gm) || []).length, count, 'one TSX block per layer with a Made with Verynize header');
      assert.equal((text.match(/<style>\{"\* \{ box-sizing: border-box; \}"\}<\/style>/g) || []).length, count);
      assert.equal(all.at(-2), 'How to implement it:');
      assert.match(all.at(-1), /^Treat the design as .*compare what you built with the design\.$/);
      assert.ok(!/wonder/i.test(text), 'no Wonder names');
    }
    let prompt = await copiedPrompt(['art'], 1);
    assertPrompt(prompt, 1);
    assert.match(prompt, /export default function Landing\(\) \{[\s\S]*className=/, 'Tailwind TSX from the codec');
    assert.match(prompt, /fonts\.googleapis\.com\/css2\?family=Inter:wght@400&display=swap/, 'Google Fonts link for Inter');
    console.log('PASS ⌘⇧⌥C copies the frame prompt');
    prompt = await copiedPrompt(['label'], 1);
    assertPrompt(prompt, 1);
    assert.match(prompt, />Canvas au<\/p>/, 'the text layer alone');
    assert.ok(!/Landing/.test(prompt), 'not its frame');
    console.log('PASS Copy prompt for a text layer');
    prompt = await copiedPrompt(['label', 'cta'], 2);
    assertPrompt(prompt, 2);
    const order = [...prompt.matchAll(/^ \* (verynize:\/\/node\/\S+)$/gm)].map(m => m[1]);
    assert.deepEqual(order, lines(prompt).slice(3, 5).map(l => l.trim()), 'snapshots follow the link order');
    assert.equal((prompt.match(/fonts\.googleapis\.com\/css2/g) || []).length, 1, 'font links only in the text block');
    assert.ok(prompt.indexOf('>Canvas au</p>') < prompt.indexOf('data-node-label="cta"'), 'blocks in selection order (text first)');
    console.log('PASS Copy prompt for a multi-selection');

    // ---- Copy as code ⌘⇧C (Wonder P1-copy-code.txt) and Copy styles / Paste styles shortcuts ----
    await seed([rect('s', 0, 0, 100, 80, {color: '#123456', radius: 7}), rect('d', 200, 0)], ['s']);
    await clearClipboard();
    await page.keyboard.press(mod('Shift+KeyC'));
    let code = '';
    for (let i = 0; i < 50 && !code; i++) { code = await readClipboard(); await page.waitForTimeout(100); }
    assert.match(code, /^\/\*\*\n \* Made with Verynize\n \* verynize:\/\/node\/\S+\n \* [A-Z][a-z]{2} \d{1,2}, \d{4}\n \*\/\n/, 'Made with Verynize header');
    assert.match(code, /export default function S\(\) \{\n {2}return \(\n {4}<>\n {6}<style>\{"\* \{ box-sizing: border-box; \}"\}<\/style>\n {6}<div [^\n]*className="[^"]*bg-\[#123456\]/, 'fragment, reset, Tailwind classes');
    assert.match(code, /<\/>\n {2}\);\n\}$/, 'ends with the component, no trailing newline');
    await page.keyboard.press(mod('Alt+KeyC'));
    await page.evaluate(() => window.design.setSelection(['d']));
    await page.keyboard.press(mod('Alt+KeyV'));
    const styled = await node('d'); assert.equal(styled.color, '#123456'); assert.equal(styled.radius, 7);
    console.log('PASS ⌘⇧C, ⌘⌥C and ⌘⌥V');

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    await fs.rm(dir, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
