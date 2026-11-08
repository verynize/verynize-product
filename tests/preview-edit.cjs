// Live preview Edit / Capture modes (Wonder PM1, PM3, PM4, PM5, X2, PP2): hover + select DOM elements, inspector
// values, staged style and direct-text edits with the "N changes" popover (hide, revert), undo/redo, add to chat,
// the discard-before-stop dialog, and element capture as native layers 100 px right of the preview.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const HTML =
  '<!doctype html><html><head><style>body{margin:0;padding:40px;font-family:system-ui;background:#f4f6fe;color:#172340}h1{margin:0 0 24px;font-size:36px;font-weight:700}</style></head><body><main><h1 id="title">Sunbird preview sandbox</h1><section><button id="count">Count: 0</button><p id="lede">Small print</p></section></main></body></html>';
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "preview-edit-"));
  // A unique path: other local apps may reuse a freed port and poll it; count only this test's page loads.
  let requests = 0;
  const token = "/edit-" + process.pid + "/";
  const server = http.createServer((request, response) => {
    if (request.url === token) requests++;
    response.setHeader("content-type", "text/html");
    response.end(HTML);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1"; env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow(); await moveOffCursor(app);
    await page.setViewportSize({ width: 1440, height: 870 });
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") console.log("PAGE", m.text());
    });
    await page.waitForFunction(
      () => !!window.livePreview?.getSelectionState && !!window.previewEdits,
    );
    await page.evaluate(
      (url) => window.livePreview.show(url),
      `http://127.0.0.1:${server.address().port}${token}`,
    );
    const frameId = await page.evaluate(() => window.livePreview.getNodeId());
    await page.locator("#preview-toolbar").waitFor();
    const frame = page.frames().find((f) => f.name() === "verynize-live-preview");
    await frame.waitForSelector("#title");
    const loads = requests;
    const text = () => frame.evaluate(() => document.getElementById("title").textContent);
    const fontSize = () =>
      frame.evaluate(() => getComputedStyle(document.getElementById("title")).fontSize);
    // Edit/Capture enabled while running; tooltip copy.
    assert.equal(await page.locator("#preview-edit").isEnabled(), true);
    await page.locator("#preview-edit").hover();
    await page
      .locator("[data-pe=preview-mode-tip]")
      .getByText("Inspect element", { exact: true })
      .waitFor();
    assert.equal(await page.locator("[data-pe=preview-mode-tip] kbd").textContent(), "⌘⇧I");
    await page.locator("#live-capture").hover();
    await page
      .locator("[data-pe=preview-mode-tip]")
      .getByText("Add an editable design to canvas")
      .waitFor();
    // ⌘⇧I toggles Edit mode; the frame gets the blue mode outline.
    await page.mouse.move(700, 300);
    await page.keyboard.press(mod("Shift+I"));
    await page.waitForFunction(() => window.livePreview.getSelectionState()?.mode === "edit");
    await page.waitForSelector("#preview-edit[aria-pressed=true]");
    await page.waitForSelector("#live-preview[data-preview-mode=edit]");
    // Wonder PM3-hover: in Edit mode, Properties stay empty until an element is picked.
    await page.locator("#screen-template").waitFor({ state: "hidden" });
    // Hover outlines the h1; click selects it with the sizing badge and the inspector.
    // Page coordinates of in-app points: the iframe sits in the zoomed canvas, so scale its viewport px.
    const box = await page.locator("#live-frame").boundingBox(),
      scale = await page
        .locator("#live-frame")
        .evaluate((el) => el.getBoundingClientRect().width / el.clientWidth);
    const h1 = await frame
      .evaluate(() => {
        const r = document.getElementById("title").getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
      .then((r) => ({
        x: box.x + r.x * scale,
        y: box.y + r.y * scale,
        width: r.width * scale,
        height: r.height * scale,
      }));
    await page.mouse.move(h1.x + 20, h1.y + h1.height / 2);
    await page.waitForFunction(() => window.previewEdits.hovered()?.tag === "h1");
    await page.locator("#live-preview .pedit-hover").waitFor();
    await page.mouse.click(h1.x + 20, h1.y + h1.height / 2);
    await page.locator("#live-preview .pedit-picked").waitFor();
    assert.match(
      await page.locator("#live-preview .pedit-badge").textContent(),
      /^\d+(\.\d+)? Fill x \d+(\.\d+)? Hug$/,
    );
    await page.locator("#preview-element-inspector").waitFor();
    assert.equal(await page.locator("[name=pe-font-size]").inputValue(), "36");
    assert.equal(await page.locator("[name=pe-x]").isDisabled(), true);
    assert.equal(await page.locator("[name=pe-color]").inputValue(), "172340");
    assert.equal(await page.locator("[name=pe-font-weight]").inputValue(), "700");
    // Wonder PM3-inspector: the layer inspector's structure, read-only where the page places the element.
    {
      const inspector = page.locator("#preview-element-inspector");
      assert.deepEqual(await inspector.locator(":scope > section > div > h3").allTextContents(), [
        "Position",
        "Layout",
        "Appearance",
        "Typography",
        "Text Fill",
      ]);
      for (const label of ["Align left", "Align top", "Rotate 90°"])
        assert.equal(await inspector.getByRole("button", { name: label, exact: true }).isDisabled(), true, label + " disabled");
      for (const name of ["pe-y", "pe-rotation", "pe-z"])
        assert.equal(await page.locator(`[name=${name}]`).isDisabled(), true, name + " disabled");
      assert.equal(await page.locator("[name=pe-rotation]").inputValue(), "0");
      assert.equal(await page.locator("[name=pe-z]").getAttribute("placeholder"), "Auto");
      for (const [axis, text] of [["h", "Left"], ["v", "Top"]]) {
        const select = inspector.locator(`[data-constraint-menu=${axis}]`);
        assert.equal(await select.isDisabled(), true, axis + " constraint disabled");
        assert.equal((await select.textContent()).trim(), text);
      }
      assert.equal(await inspector.locator("[aria-label=Constraints][data-disabled]").count(), 1);
      assert.equal(await page.locator("[name=pe-min-width]").inputValue(), "0");
      assert.equal(await page.locator("[name=pe-min-height]").inputValue(), "0");
      assert.equal(await inspector.getByRole("checkbox", { name: "Clip content" }).getAttribute("aria-checked"), "false");
      assert.equal(await page.locator("[name=pe-line-height]").inputValue(), "Auto");
      // The page's system-ui is not a font a design can carry: "(unsupported)", as in Wonder.
      await inspector.getByRole("button", { name: "Font family" }).filter({ hasText: "system-ui (unsupported)" }).waitFor();
    }
    // Style edit through the inspector is staged on the live DOM.
    await page.locator("[name=pe-font-size]").fill("40");
    await page.locator("[name=pe-font-size]").press("Enter");
    await frame.waitForFunction(
      () => getComputedStyle(document.getElementById("title")).fontSize === "40px",
    );
    await page
      .locator("#live-preview [data-pe=preview-changes-badge]")
      .filter({ hasText: "1 change" })
      .waitFor();
    assert.equal(await page.evaluate((id) => window.previewEdits.count(id), frameId), 1);
    // The badge sits in the breadcrumb row above the browser toolbar, never over Publish / Stop (Wonder PM3-edited).
    {
      const badge = await page.locator("#live-preview [data-pe=preview-changes-badge]").boundingBox();
      const bar = await page.locator("#live-preview .pf-bar").boundingBox();
      assert.ok(badge.y + badge.height <= bar.y + 0.5, `badge ${JSON.stringify(badge)} is above the toolbar ${JSON.stringify(bar)}`);
      assert.ok(Math.abs(badge.x + badge.width - (bar.x + bar.width - 5)) < 2, "badge is right-aligned with the frame");
    }
    // Wonder PF4-resize: on a phone-width frame the breadcrumb truncates with an ellipsis before the badge.
    {
      const width = await page.evaluate((id) => window.design.getDocument().pages.flatMap((p) => p.nodes).find((n) => n.id === id).w, frameId);
      await page.evaluate((id) => window.design.updateNodes([id], { w: 402 }), frameId);
      await page.waitForFunction(() => {
        const text = document.querySelector("#live-preview .pf-crumb-text");
        return text && text.scrollWidth > text.clientWidth;
      });
      const crumb = await page.locator("#live-preview .pf-crumb-text").evaluate((el) => ({
        overflow: getComputedStyle(el).textOverflow,
        right: el.parentElement.getBoundingClientRect().right,
        local: el.parentElement.querySelector(".pf-local").getBoundingClientRect().right,
      }));
      const badge = await page.locator("#live-preview [data-pe=preview-changes-badge]").boundingBox();
      assert.equal(crumb.overflow, "ellipsis");
      assert.ok(crumb.local <= badge.x, `breadcrumb ends (${crumb.local}) before the badge (${badge.x})`);
      await page.evaluate(([id, w]) => window.design.updateNodes([id], { w }), [frameId, width]);
      await page.waitForFunction(() => {
        const text = document.querySelector("#live-preview .pf-crumb-text");
        return text.scrollWidth <= text.clientWidth;
      });
    }
    // Double-click a word edits the text in place.
    const word = await frame.evaluate(() => {
      const node = document.getElementById("title").firstChild,
        range = document.createRange();
      const i = node.textContent.indexOf("preview");
      range.setStart(node, i + 2);
      range.setEnd(node, i + 3);
      const r = range.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.dblclick(box.x + word.x * scale, box.y + word.y * scale);
    await frame.waitForFunction(
      () =>
        document.getElementById("title").isContentEditable &&
        getSelection().toString() === "preview",
    );
    assert.equal(
      await frame.evaluate(() => getComputedStyle(document.getElementById("title")).outlineStyle),
      "none",
      "no page focus ring around the edited text",
    );
    await page.keyboard.type("edited");
    await page.keyboard.press("Escape");
    await page.waitForFunction((id) => window.previewEdits.count(id) === 2, frameId);
    assert.equal(
      await frame.evaluate(() => !!document.getElementById("verynize-edit-style") || document.getElementById("title").hasAttribute("data-verynize-editing")),
      false,
      "editing styles are removed when the edit ends",
    );
    assert.equal(await text(), "Sunbird edited sandbox");
    assert.equal(
      await frame.evaluate(() => document.getElementById("title").hasAttribute("contenteditable")),
      false,
    );
    // Changes popover: rows, hide all (compare), per-item revert.
    await page
      .locator("#live-preview [data-pe=preview-changes-badge]")
      .filter({ hasText: "2 changes" })
      .click();
    const popover = page.locator("#preview-changes");
    await popover.waitFor();
    for (const copy of [
      "Preview changes",
      "Not in your code yet",
      "Hide all changes",
      "Compare with the original",
      "Revert all changes",
      "Puts back the original values",
    ])
      await popover.getByText(copy, { exact: true }).waitFor();
    assert.equal(
      await popover.locator("[data-prop=text] s").textContent(),
      "“Sunbird preview sandbox”",
    );
    assert.equal(
      await popover
        .locator("[data-prop=text] [data-pe=preview-change-values] > span")
        .textContent(),
      "“Sunbird edited sandbox”",
    );
    assert.match(
      await popover.locator("[data-pe=preview-change-name]").first().textContent(),
      /^h1 /,
    );
    await popover.locator("#preview-changes-hide").click();
    await frame.waitForFunction(
      () =>
        document.getElementById("title").textContent === "Sunbird preview sandbox" &&
        getComputedStyle(document.getElementById("title")).fontSize === "36px",
    );
    await popover.locator("#preview-changes-hide").click();
    await frame.waitForFunction(
      () => document.getElementById("title").textContent === "Sunbird edited sandbox",
    );
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });
    // Undo / redo (⌘Z / ⌘⇧Z) walk the staged history.
    await page.mouse.move(700, 820);
    await page.keyboard.press(mod("Z"));
    await frame.waitForFunction(
      () => document.getElementById("title").textContent === "Sunbird preview sandbox",
    );
    assert.equal(await fontSize(), "40px");
    await page.keyboard.press(mod("Shift+Z"));
    await frame.waitForFunction(
      () => document.getElementById("title").textContent === "Sunbird edited sandbox",
    );
    assert.equal(await page.evaluate((id) => window.previewEdits.count(id), frameId), 2);
    // Add to chat ⌘L: an element chip, nothing sent. Wonder PM5: the composer then holds only the element chip, not the
    // preview frame's own selection chip.
    assert.ok(
      await page.evaluate((id) => (window.agentWorkspace.getState().mentions || []).some((m) => m.id === id), frameId),
      "the selected preview frame starts as a selection chip",
    );
    await page.keyboard.press(mod("L"));
    await page.waitForFunction(() =>
      (window.agentWorkspace.getState().mentions || []).some((m) => m.type === "element"),
    );
    const mention = await page.evaluate(() =>
      window.agentWorkspace.getState().mentions.find((m) => m.type === "element"),
    );
    assert.equal(mention.label, 'h1 "Sunbird edited…');
    assert.match(mention.id, /^preview:#title$/);
    await page.getByText('h1 "Sunbird edited…', { exact: true }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.agentWorkspace.getState().mentions.map((m) => m.type)),
      ["element"],
      "only the element chip is in the composer",
    );
    assert.equal(
      await page.evaluate(
        () => window.agentWorkspace.getHistory().flatMap((c) => c.messages || []).length,
      ),
      0,
      "nothing was sent",
    );
    await page.evaluate(() => window.agentWorkspace.closeChat());
    // Discard dialog: Keep editing resolves false, Discard and stop resolves true and clears the edits.
    const ask = () =>
      page.evaluate((id) => {
        window.__stopAnswer = undefined;
        void window.previewEdits.confirmBeforeStop(id).then((ok) => {
          window.__stopAnswer = ok;
        });
      }, frameId);
    await ask();
    const dialog = page.locator("#preview-discard-dialog");
    await dialog.waitFor();
    assert.equal(await dialog.locator("h2").textContent(), "Discard preview edits?");
    assert.match(
      await dialog.locator("p").textContent(),
      /^2 unsaved edits will be lost when this preview stops\.This can’t be undone\.$/,
    );
    const size = await dialog.boundingBox();
    assert.equal(Math.round(size.width), 400);
    await page.screenshot({ path: "/tmp/verynize-preview-discard.png" });
    await dialog.locator("#preview-discard-keep").click();
    await page.waitForFunction(() => window.__stopAnswer === false);
    assert.equal(await page.evaluate((id) => window.previewEdits.count(id), frameId), 2);
    await ask();
    await dialog.locator("#preview-discard-confirm").click();
    await page.waitForFunction(() => window.__stopAnswer === true);
    assert.equal(await page.evaluate((id) => window.previewEdits.count(id), frameId), 0);
    await frame.waitForFunction(
      () =>
        document.getElementById("title").textContent === "Sunbird preview sandbox" &&
        getComputedStyle(document.getElementById("title")).fontSize === "36px",
    );
    await page
      .locator("#live-preview [data-pe=preview-changes-badge]")
      .waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate((id) => window.previewEdits.confirmBeforeStop(id), frameId),
      true,
      "no dialog without edits",
    );
    // Capture mode: hover badge W × H and keyboard strip; ↑ selects the parent, ↓ goes back; click captures the h1 as Text.
    await page.locator("#live-capture").click();
    await page.waitForFunction(() => window.livePreview.getSelectionState()?.mode === "capture");
    await page.locator("#live-preview .pedit-keys").waitFor();
    await page.mouse.move(h1.x + 20, h1.y + h1.height / 2);
    await page.waitForFunction(() => window.previewEdits.target()?.tag === "h1");
    assert.match(await page.locator("#live-preview .pedit-tag").textContent(), /^\d+ × \d+$/);
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => window.previewEdits.target()?.tag === "main");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => window.previewEdits.target()?.tag === "h1");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.previewEdits.target()?.tag === "section");
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => window.previewEdits.target()?.tag === "h1");
    const before = await page.evaluate(() => window.design.getCamera());
    await page.mouse.click(h1.x + 20, h1.y + h1.height / 2);
    await page.waitForFunction(() =>
      window.design
        .getDocument()
        .pages.some((p) =>
          p.nodes.some(
            (n) => n.type === "text" && n.text === "Sunbird preview sandbox" && !n.parentId,
          ),
        ),
    );
    const result = await page.evaluate((id) => {
      const nodes = window.design.getDocument().pages.flatMap((p) => p.nodes);
      return {
        preview: nodes.find((n) => n.id === id),
        text: nodes.find(
          (n) => n.type === "text" && !n.parentId && n.text === "Sunbird preview sandbox",
        ),
        selection: window.design.getSelection(),
        camera: window.design.getCamera(),
      };
    }, frameId);
    assert.equal(result.text.name, "Text");
    assert.equal(result.text.x, result.preview.x + result.preview.w + 100);
    assert.equal(result.text.y, result.preview.y);
    assert.equal(Number(result.text.fontSize), 36);
    assert.equal(String(result.text.fontWeight), "700");
    assert.equal(result.text.color, "#172340", "text colour is an editable Text Fill");
    assert.deepEqual(
      result.text.backgroundFills,
      [{ type: "solid", color: "#f4f6fe" }],
      "the page colour behind the element is the text's Background Fill (Wonder PM4-result)",
    );
    // Wonder PM4-result: CSS line-height normal is Auto, and the captured text clips its content.
    assert.equal(result.text.lineHeight, "auto");
    assert.equal(result.text.clipContent, true);
    assert.equal(await page.locator("#properties [name=lineHeight]").inputValue(), "Auto");
    assert.equal(
      await page.locator("#properties").getByRole("checkbox", { name: "Clip content" }).getAttribute("aria-checked"),
      "true",
    );
    assert.deepEqual(result.selection, [result.text.id]);
    assert.notEqual(result.camera.x, before.x, "camera pans to the capture");
    assert.equal(result.camera.y, before.y, "an in-view capture is revealed by a sideways pan only");
    // ⌘Return captures the whole page (one region frame, as the toolbar capture always did).
    await page.evaluate((id) => window.design.setSelection([id]), frameId);
    await page.locator("#live-capture").click();
    await page.waitForFunction(() => window.livePreview.getSelectionState()?.mode === "capture");
    await page.keyboard.press(mod("Enter"));
    await page.waitForFunction(() =>
      window.design
        .getDocument()
        .pages.some((p) =>
          p.nodes.some((n) => !n.parentId && n.type === "frame" && n.name === "Captured region"),
        ),
    );
    // Esc leaves Capture mode.
    await page.evaluate((id) => window.design.setSelection([id]), frameId);
    await page.locator("#live-capture").click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.livePreview.getSelectionState()?.mode === "select");
    await page.locator("#screen-template").waitFor({ state: "visible" });
    assert.equal(requests, loads, "edits and captures never reload the app");
    assert.equal(loads, 1);
    console.log(
      "PASS preview edit: modes + tooltips, ⌘⇧I, hover/select/inspector, staged style + text edits, changes popover, undo/redo, add to chat, discard dialog, element/page capture placement and naming",
    );
  } finally {
    await app.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
