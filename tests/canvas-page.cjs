const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + "/bd-page-"),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    timeout: 20000,
    env,
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const p = await app.firstWindow({ timeout: 15000 });
    await waitForUiReady(p);
    await p.waitForSelector("#canvas .layer");
    // A new page is empty: no white artboard behind it.
    await p.locator("#add-page").click();
    assert.equal(await p.locator("#canvas .layer").count(), 0);
    assert.equal(
      await p.locator("#canvas").evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    // Frames carry no grey outline unless selected.
    // The toolbar Frame button arms the tool (Wonder D1); a click on the canvas makes the frame.
    await p.locator("#add-frame").click();
    assert.equal(
      await p.locator("#canvas .layer").count(),
      0,
      "arming the frame tool creates nothing",
    );
    await p.locator("#canvas-wrap").click();
    assert.equal(await p.locator("#canvas .frame-layer").count(), 1);
    await p.evaluate(() => window.design.setSelection([]));
    assert.equal(
      await p.locator("#canvas .frame-layer").evaluate((e) => getComputedStyle(e).outlineStyle),
      "none",
    );
    // Nothing selected: Variables collapsed, Properties shows the page colour.
    assert.equal(
      await p
        .locator("#insp-variables button[aria-expanded]")
        .first()
        .getAttribute("aria-expanded"),
      "false",
    );
    await p.locator("#page-section").waitFor();
    await p.locator("#page-section input").fill("112233");
    await p.locator("#page-section input").press("Enter");
    await p.waitForFunction(() => {
      const d = window.design.getDocument();
      return d.pages.find((x) => x.id === d.activePage).background === "#112233";
    });
    assert.equal(
      await p.locator("#workspace").evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(17, 34, 51)",
    );
    assert.equal(
      await p.evaluate(() => {
        try {
          window.design.updatePage({ background: "red" });
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    // Page paint belongs to the viewport, even far beyond the transformed canvas.
    const originalCamera = await p.evaluate(() => window.design.getCamera());
    for (const pan of [0, 100000, -100000]) {
      await p.evaluate((pan) => window.design.setCamera(pan, pan, 0.02), pan);
      await p.waitForFunction(
        () => document.querySelector("#zoom-menu-button").textContent === "2%",
      );
      const box = await p.locator("#canvas-wrap").boundingBox();
      for (const [fx, fy] of [
        [0.15, 0.25],
        [0.85, 0.25],
        [0.15, 0.65],
        [0.85, 0.65],
      ]) {
        const png = await p.screenshot({
          clip: {
            x: Math.round(box.x + box.width * fx),
            y: Math.round(box.y + box.height * fy),
            width: 2,
            height: 2,
          },
        });
        const pixels = await app.evaluate(
          ({ nativeImage }, bytes) => [
            ...nativeImage.createFromBuffer(Buffer.from(bytes)).toBitmap(),
          ],
          [...png],
        );
        for (let i = 0; i < pixels.length; i += 4) {
          assert.deepEqual(
            pixels.slice(i, i + 4),
            [51, 34, 17, 255],
            `page background at 2%, pan ${pan}`,
          );
        }
      }
    }
    await p.evaluate(({ x, y, zoom }) => window.design.setCamera(x, y, zoom), originalCamera);
    // Page eye (properties-audit C8, Wonder H8): hides the page background and keeps the colour. The page turns
    // transparent: the canvas shows a checkerboard, the field reads 0 % (dimmed) and still shows the hex.
    const opacity = () =>
      p
        .locator("#page-section [data-page-opacity]")
        .innerText()
        .then((t) => t.replace(/\s+/g, " ").trim());
    assert.equal(await opacity(), "100 %");
    await p.locator('[aria-label="Hide page background"]').click();
    assert.equal(
      await p.evaluate(() => {
        const d = window.design.getDocument();
        const pg = d.pages.find((x) => x.id === d.activePage);
        return [pg.background, pg.backgroundHidden].join();
      }),
      "#112233,true",
    );
    const ws = await p.locator("#workspace").evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        img: s.backgroundImage,
        color: s.backgroundColor,
        inline: e.style.backgroundColor,
        cls: e.classList.contains("page-transparent"),
      };
    });
    assert.ok(ws.cls && !ws.inline, "hidden page background drops the page colour");
    assert.match(
      ws.img,
      /^repeating-conic-gradient/,
      "hidden page background shows a checkerboard",
    );
    assert.notEqual(ws.color, "rgb(17, 34, 51)");
    assert.equal(await opacity(), "0 %");
    assert.equal(await p.locator("#page-section input").inputValue(), "112233", "the hex is kept");
    assert.equal(
      await p.evaluate(() => {
        try {
          window.design.updatePage({ backgroundHidden: false });
          return false;
        } catch {
          return true;
        }
      }),
      true,
      "backgroundHidden is true or absent",
    );
    await p.locator('[aria-label="Show page background"]').click();
    assert.equal(
      await p.evaluate(() => {
        const d = window.design.getDocument();
        return "backgroundHidden" in d.pages.find((x) => x.id === d.activePage);
      }),
      false,
    );
    assert.equal(
      await p.locator("#workspace").evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(17, 34, 51)",
    );
    assert.equal(
      await p.locator("#workspace").evaluate((e) => getComputedStyle(e).backgroundImage),
      "none",
      "unhide removes the checkerboard",
    );
    assert.equal(await opacity(), "100 %");
    await p.locator('[aria-label="Reset page colour"]').click();
    assert.equal(
      await p.evaluate(() => {
        const d = window.design.getDocument();
        return "background" in d.pages.find((x) => x.id === d.activePage);
      }),
      false,
    );
    // Selecting a layer keeps Variables collapsed and hides the page section.
    await p.evaluate(() => {
      const d = window.design.getDocument();
      window.design.setSelection([d.pages.find((x) => x.id === d.activePage).nodes[0].id]);
    });
    await p.locator("#page-section").waitFor({ state: "detached" });
    assert.equal(
      await p
        .locator("#insp-variables button[aria-expanded]")
        .first()
        .getAttribute("aria-expanded"),
      "false",
    );
    // Accordion: Variables, Icons and a collapsed Properties stack directly, not pinned to the bottom of the panel.
    await p.locator("#insp-properties button[aria-expanded]").first().click();
    const [vars, icons, props] = await Promise.all(
      ["#insp-variables", "#insp-icons", "#insp-properties"].map((s) => p.locator(s).boundingBox()),
    );
    assert.ok(
      Math.abs(icons.y - (vars.y + vars.height)) <= 1 &&
        Math.abs(props.y - (icons.y + icons.height)) <= 1,
      "Sections stack like an accordion",
    );
    await p.locator("#insp-properties button[aria-expanded]").first().click();
    // The title-bar sidebar toggle shows the repositories / chats sidebar and leaves the layers panel alone.
    const layersBefore = await p.locator("#layer-panel").boundingBox();
    await p.locator("#chrome-sidebar").click();
    await p.locator("#design-chat-sidebar #code-sidebar").waitFor();
    assert.equal(await p.evaluate(() => document.body.classList.contains("left-collapsed")), false);
    const sidebar = await p.locator("#design-chat-sidebar").boundingBox(),
      layersAfter = await p.locator("#layer-panel").boundingBox();
    assert.ok(
      Math.abs(layersAfter.x - (sidebar.x + sidebar.width)) <= 1 && layersAfter.x > layersBefore.x,
      "Editor shifts right of the chat sidebar",
    );
    await p.locator("#chat-sidebar-close").click();
    await p.locator("#design-chat-sidebar").waitFor({ state: "detached" });
    // Panels on the left do not move the artwork on screen.
    const layerX = () =>
      p
        .locator("#canvas .layer")
        .first()
        .evaluate((e) => e.getBoundingClientRect().x);
    await p.waitForTimeout(150);
    const x0 = await layerX();
    await p.locator("#chrome-sidebar").click();
    await p.locator("#design-chat-sidebar").waitFor();
    await p.waitForTimeout(150);
    assert.ok(
      Math.abs((await layerX()) - x0) <= 1,
      "Canvas stays put when the chats sidebar opens",
    );
    await p.locator("#chat-sidebar-close").click();
    await p.waitForTimeout(150);
    assert.ok(
      Math.abs((await layerX()) - x0) <= 1,
      "Canvas stays put when the chats sidebar closes",
    );
    // The chat dock and the layers panel can be open together.
    await p.locator("#shell-chat").click();
    await p.waitForFunction(
      () =>
        document.body.classList.contains("agent-chat-open") &&
        document.body.classList.contains("left-collapsed"),
    );
    await p.locator('#bd-page-pill [aria-label="Show sidebar"]').click();
    await p.waitForFunction(() => !document.body.classList.contains("left-collapsed"));
    assert.equal(await p.evaluate(() => document.body.classList.contains("agent-chat-open")), true);
    const dock = await p.locator("#agent-chat-dock").boundingBox(),
      layers = await p.locator("#layer-panel").boundingBox();
    assert.ok(
      layers.width > 200 && layers.x >= dock.x + dock.width - 1,
      "Layers sit right of the chat dock",
    );
    await p.evaluate(() => window.agentWorkspace.closeChat());
    // Icons: the file's own SVG library. Paste markup (scripts stripped), insert, add from selection, list view, undo.
    await p.locator("#insp-icons button[aria-expanded]").first().click();
    await p.locator("#insp-icons").getByText("Reuse icons across this file").waitFor();
    await p.locator("#add-icon-asset").click();
    await p.locator("#icon-paste").click();
    await p
      .locator("#icon-paste-dialog textarea")
      .fill(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" onload="alert(1)"><title>Spark</title><style>@import "https://example.com/style.css";</style><rect fill="url(https://example.com/image.svg)"/><script>alert(1)</script><path d="M4 4h24v24H4z"/></svg>',
      );
    await p.locator("#icon-paste-ok").click();
    await p.waitForFunction(() => window.design.getDocument().icons?.length === 1);
    const icon = await p.evaluate(() => window.design.getDocument().icons[0]);
    assert.equal(icon.name, "Spark");
    const markup = Buffer.from(icon.src.split(",")[1], "base64").toString();
    assert.ok(!/script|onload|url\(|@import/i.test(markup), "Pasted SVG is sanitised");
    const count = () =>
      p.evaluate(() => {
        const d = window.design.getDocument();
        return d.pages.find((x) => x.id === d.activePage).nodes.length;
      });
    const before = await count();
    await p.locator(`#insp-icons [data-icon-id="${icon.id}"]`).click();
    assert.equal(await count(), before + 1);
    const inserted = await p.evaluate(() => {
      const d = window.design.getDocument();
      return d.pages.find((x) => x.id === d.activePage).nodes.at(-1);
    });
    assert.deepEqual(
      [inserted.type, inserted.w, inserted.h, inserted.src],
      ["image", 32, 32, icon.src],
    );
    await p.locator("#add-icon-asset").click();
    await p.locator("#icon-from-selection").click();
    await p.waitForFunction(() => window.design.getDocument().icons?.length === 2);
    await p.locator("#icons-view").click();
    assert.equal(await p.locator("#insp-icons [data-icon-id]").first().textContent(), "Spark");
    await p.keyboard.press("Escape");
    await p.evaluate(() => window.design.setSelection([]));
    await p.locator("#undo").evaluate((e) => e.click());
    await p.waitForFunction(() => window.design.getDocument().icons?.length === 1);
    // An open section fills the panel: the collapsed Properties below the open Icons sits at the bottom.
    await p.locator("#insp-properties button[aria-expanded]").first().click();
    const [panel, propsBox] = await Promise.all(
      ["#properties", "#insp-properties"].map((s) => p.locator(s).boundingBox()),
    );
    assert.ok(
      Math.abs(propsBox.y + propsBox.height - (panel.y + panel.height)) <= 2,
      "Collapsed Properties sits at the bottom under an open section",
    );
    // Open sections share the panel height equally (Wonder): two open → halves, three open → thirds.
    const heights = () =>
      Promise.all(
        ["#insp-variables", "#insp-icons", "#insp-properties"].map((s) =>
          p
            .locator(s)
            .boundingBox()
            .then((b) => b.height),
        ),
      );
    await p.locator("#insp-variables button[aria-expanded]").first().click();
    let [hv, hi] = await heights();
    assert.ok(Math.abs(hv - hi) <= 2, `Two open sections split evenly (${hv} vs ${hi})`);
    await p.locator("#insp-properties button[aria-expanded]").first().click();
    const three = await heights();
    assert.ok(
      Math.max(...three) - Math.min(...three) <= 2,
      `Three open sections split evenly (${three})`,
    );
    console.log(
      "PASS page: empty new page, no frame outline, page colour with variables collapsed, accordion properties, chat sidebar toggle, stable canvas, chat + layers, icon library",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
