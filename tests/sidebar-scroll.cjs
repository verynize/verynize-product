// Long lists must stay bounded with and without the chat dock, including short windows.
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "sidebar-scroll-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await moveOffCursor(app);
    await waitForUiReady(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate(() => {
      const doc = window.design.getDocument();
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        id: `layer-${i}`,
        name: `Component ${i}`,
        type: "frame",
        component: true,
        x: i * 120,
        y: 0,
        w: 100,
        h: 80,
        color: "#8844cc",
        layout: "free",
      }));
      doc.pages = Array.from({ length: 60 }, (_, i) => ({
        id: `page-${i}`,
        name: `Page ${i}`,
        nodes: i === 0 ? nodes : [],
      }));
      doc.activePage = "page-0";
      doc.icons = Array.from({ length: 100 }, (_, i) => ({
        id: `icon-${i}`,
        name: `Icon ${i}`,
        src:
          "data:image/svg+xml;base64," +
          btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>',
          ),
      }));
      doc.tokens = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`color${i}`, "#8844cc"]),
      );
      window.design.setDocument(doc);
      window.design.setSelection(["layer-0"]);
    });
    await page.locator("#components-panel button[aria-expanded]").click();
    await page.locator("#insp-variables button[aria-expanded]").first().click();
    await page.locator("#insp-icons button[aria-expanded]").first().click();
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    async function assertScrollable(selector, label) {
      const metrics = await page.locator(selector).evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        const r = el.getBoundingClientRect();
        return {
          height: el.clientHeight,
          total: el.scrollHeight,
          scroll: el.scrollTop,
          top: r.top,
          bottom: r.bottom,
          viewport: innerHeight,
        };
      });
      assert.ok(
        metrics.height >= 20,
        `${label}: usable scroll viewport ${JSON.stringify(metrics)}`,
      );
      assert.ok(
        metrics.total > metrics.height,
        `${label}: long list overflows ${JSON.stringify(metrics)}`,
      );
      assert.ok(metrics.scroll > 0, `${label}: can reach end ${JSON.stringify(metrics)}`);
      assert.ok(
        metrics.top >= 0 && metrics.bottom <= metrics.viewport + 1,
        `${label}: within window ${JSON.stringify(metrics)}`,
      );
    }
    for (const chat of [false, true]) {
      if (chat) {
        await page.locator("#shell-chat").click();
        await page.waitForFunction(
          () =>
            document.body.classList.contains("agent-chat-open") &&
            document.body.classList.contains("left-collapsed"),
        );
        await page.evaluate(() => document.body.classList.remove("left-collapsed"));
      }
      for (const height of [870, 480]) {
        await page.setViewportSize({ width: 1440, height });
        await settle();
        const label = `${chat ? "chat open" : "chat closed"}, height ${height}`;
        await assertScrollable("#bd-page-list", `${label}: pages`);
        await assertScrollable("#bd-layer-tree", `${label}: layers`);
        await assertScrollable("#bd-components-body", `${label}: components`);
        await assertScrollable("#insp-icons [data-scroll]", `${label}: icons`);
        await assertScrollable("#insp-variables > div:last-child", `${label}: variables`);
        await assertScrollable("#insp-properties [data-scroll]", `${label}: properties`);
        for (const title of ["Pages", "Components", "Layers"]) {
          const header = page
            .locator(`#layer-panel button[aria-expanded][aria-controls]`)
            .filter({ hasText: title });
          const box = await header.boundingBox();
          assert.ok(
            box && box.y >= 0 && box.y + box.height <= height,
            `${label}: ${title} header reachable`,
          );
        }
      }
    }
    // Wheel input must scroll the actual lists, not just accept programmatic scrollTop.
    for (const selector of [
      "#bd-page-list",
      "#bd-layer-tree",
      "#bd-components-body",
      "#insp-variables > div:last-child",
      "#insp-icons [data-scroll]",
      "#insp-properties [data-scroll]",
    ]) {
      const list = page.locator(selector);
      await list.evaluate((el) => {
        el.scrollTop = 0;
      });
      await list.hover();
      await page.mouse.wheel(0, 600);
      await page.waitForFunction((selector) => {
        const el = document.querySelector(selector);
        return el.scrollTop > 0;
      }, selector);
    }
    // Collapsing one section returns room to the others.
    await page.locator("#components-panel button[aria-expanded]").click();
    await settle();
    await assertScrollable("#bd-layer-tree", "layers after collapsing components");
    for (const selector of [
      "#bd-components-body",
      "#bd-page-list",
      "#bd-layer-tree",
      "#insp-variables [data-scroll]",
      "#insp-icons [data-scroll]",
      "#insp-properties [data-scroll]",
    ]) {
      const header = page
        .locator(
          selector.startsWith("#insp-")
            ? selector.split(" ")[0] + " button[aria-expanded]"
            : `#layer-panel button[aria-controls="${selector.slice(1)}"]`,
        )
        .first();
      if ((await header.getAttribute("aria-expanded")) === "true") await header.click();
      assert.equal(
        await page.locator(selector).isVisible(),
        false,
        `${selector}: collapsed body is hidden`,
      );
      await header.click();
      assert.equal(await page.locator(selector).isVisible(), true, `${selector}: expands again`);
    }
    await page.evaluate(() =>
      window.design.setSelection(Array.from({ length: 100 }, (_, i) => `layer-${i}`)),
    );
    await page.waitForFunction(
      () => document.querySelectorAll("#agent-chat-dock .chat-mentions button").length >= 20,
    );
    await assertScrollable("#agent-chat-dock .chat-mentions", "many selection chips");
    const prompt = await page.locator("#project-prompt").boundingBox();
    assert.ok(
      prompt && prompt.y >= 0 && prompt.y + prompt.height <= 480,
      "composer remains reachable with many chips",
    );
    if (process.env.VERYNIZE_EVIDENCE_DIR) {
      await fs.mkdir(process.env.VERYNIZE_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.VERYNIZE_EVIDENCE_DIR, "sidebar-scroll.png"),
      });
    }
    // At extreme heights, outer fallback scrolling must still expose every disclosure.
    await page.setViewportSize({ width: 1440, height: 240 });
    await settle();
    for (const selector of ["#layer-panel [data-sidebar-sections]", "#bd-inspector-root > div"]) {
      const outer = page.locator(selector);
      const overflow = await outer.evaluate((el) => ({
        height: el.clientHeight,
        total: el.scrollHeight,
        viewport: innerHeight,
        sections: [...el.querySelectorAll(":scope > section")].map((s) => ({
          height: s.clientHeight,
          min: getComputedStyle(s).minHeight,
        })),
      }));
      assert.ok(
        overflow.total > overflow.height,
        `${selector}: outer fallback is available ${JSON.stringify(overflow)}`,
      );
      const headers = outer.locator(":scope > section > div:first-child > button[aria-expanded]");
      assert.equal(await headers.count(), 3, `${selector}: all three section headers exist`);
      for (const header of await headers.all()) {
        await header.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
        const box = await header.boundingBox();
        assert.ok(
          box && box.y >= 0 && box.y + box.height <= 240,
          `${selector}: section reachable at extreme height`,
        );
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS sidebar scrolling: 60 pages, 100 components/layers/variables, property sections, chat dock, short window, wheel input and collapse",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
