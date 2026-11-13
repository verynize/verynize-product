const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "bd-loading-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    for (const name of ["Sample A", "Sample B"]) {
      await page.evaluate(async (name) => {
        const doc = window.design.getDocument();
        doc.name = name;
        await window.fileLibrary.createFromDocument(doc);
        localStorage.setItem("verynize.switchLoading.delay", "0");
      }, name);
    }
    const emit = (token, kind, phase) =>
      page.evaluate(
        (detail) => {
          window.dispatchEvent(new CustomEvent("switch-loading-change", { detail }));
        },
        {
          token,
          kind,
          phase,
          from: { fileKey: "a", pageId: "a" },
          to: { fileKey: "b", pageId: "b" },
        },
      );
    const visible = (kind) =>
      page.waitForFunction(
        (kind) => document.querySelector("#workspace").dataset.switchLoading === kind,
        kind,
      );
    const clean = () =>
      page.waitForFunction(() => !document.querySelector("#workspace").dataset.switchLoading);
    const out = path.resolve("design/pen-parity/switch-loading-audit/track-a");
    await fs.mkdir(out, { recursive: true });
    const shot = (name) =>
      page.screenshot({
        path: path.join(out, `${name}.png`),
        style: "#presence-slot { visibility: hidden !important; }",
      });
    await shot("file-before");
    await emit(1, "file", "begin");
    await visible("file");
    const logo = page.locator("#switch-loading-logo");
    assert.equal(await logo.isVisible(), true);
    assert.equal(await logo.getAttribute("aria-label"), "Loading file");
    // Like Pen: only the title bar and the mark; the cover spans sidebar, workspace and inspector.
    const main = await page.locator("main").boundingBox();
    const cover = await logo.boundingBox();
    assert.deepEqual(cover, main);
    const mark = await logo.locator("svg").boundingBox();
    assert.ok(Math.abs(mark.x + mark.width / 2 - main.x - main.width / 2) < 2);
    assert.ok(Math.abs(mark.y + mark.height / 2 - main.y - main.height / 2) < 2);
    for (const panel of ["#layer-panel", "#properties"])
      assert.equal(
        await page.locator(panel).evaluate((el) => getComputedStyle(el).visibility),
        "hidden",
        panel + " is hidden under the file cover",
      );
    await shot("file-after");
    await page.locator("[data-file-tab]:visible").filter({ hasText: "Sample A" }).click();
    await page.waitForFunction(() => window.design.getDocument().name === "Sample A");
    await emit(1, "file", "end");
    await clean();
    await shot("page-before");
    await emit(2, "page", "begin");
    await visible("page");
    assert.equal(
      await page.locator("#canvas").evaluate((el) => getComputedStyle(el).filter),
      "blur(16px)",
    );
    assert.equal(
      await page.locator("#layer-panel").evaluate((el) => getComputedStyle(el).filter),
      "none",
    );
    assert.equal(
      await page.locator("#properties").evaluate((el) => getComputedStyle(el).filter),
      "none",
    );
    assert.equal(
      await page.locator("#canvas").evaluate((el) => getComputedStyle(el).pointerEvents),
      "none",
    );
    assert.equal(await page.locator("#canvas").evaluate((el) => !!el.closest("[inert]")), true);
    assert.equal(
      await page.evaluate(() => {
        const event = new KeyboardEvent("keydown", {
          key: "Delete",
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      true,
    );
    await shot("page-after");
    await emit(3, "file", "begin");
    await emit(2, "page", "end");
    await visible("file");
    // The fading cover is visual only: the pointer already reaches the canvas, so a move made while it fades is
    // the editor's (collaborator cursors, hover). Checked in the same task as the event that starts the fade.
    const fading = await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("switch-loading-change", {
          detail: { token: 3, kind: "file", phase: "fail" },
        }),
      );
      const area = document.getElementById("workspace").getBoundingClientRect();
      const hit = document.elementFromPoint(area.x + area.width / 2, area.y + area.height / 2);
      return {
        leaving: document.body.dataset.switchLeaving ?? null,
        shown: getComputedStyle(document.getElementById("switch-loading-logo")).display,
        inWorkspace: !!hit?.closest("#workspace"),
      };
    });
    assert.deepEqual(fading, { leaving: "true", shown: "flex", inWorkspace: true });
    await clean();
    assert.equal(await page.locator("#canvas").evaluate((el) => !!el.closest("[inert]")), false);
    await page.evaluate(() => {
      document.documentElement.dataset.uiTheme = "light";
    });
    await emit(4, "file", "begin");
    await visible("file");
    assert.equal(
      await logo.evaluate((el) => getComputedStyle(el).backgroundColor),
      await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--canvas)";
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      }),
    );
    await shot("file-light-after");
    await emit(4, "file", "cancel");
    await clean();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await emit(5, "page", "begin");
    await visible("page");
    await shot("page-light-after");
    await emit(5, "page", "ready");
    await clean();
    await page.evaluate(() => localStorage.setItem("verynize.switchLoading.delay", "120"));
    await page.evaluate(() => {
      for (const phase of ["begin", "ready"])
        window.dispatchEvent(
          new CustomEvent("switch-loading-change", { detail: { token: 6, kind: "file", phase } }),
        );
    });
    await page.waitForTimeout(180);
    assert.equal(await logo.isVisible(), false, "instant ready never shows a loading surface");
    await emit(7, "file", "begin");
    await visible("file");
    await page.evaluate(() => window.fileLibrary.showHome());
    await clean();
    await page.evaluate(() => window.fileLibrary.showEditor());
    // A switch that began before the ui bundle mounted must still show its visual.
    await page.addInitScript(() => {
      let coordinator;
      Object.defineProperty(window, "switchCoordinator", {
        configurable: true,
        get: () => coordinator,
        set(value) {
          coordinator = value;
          window.__earlySwitch = value.begin({ kind: "page", from: {}, to: {} });
        },
      });
    });
    await page.reload();
    await waitForUiReady(page);
    await visible("page");
    await page.evaluate(() => window.switchCoordinator.finish(window.__earlySwitch));
    await clean();
    console.log(
      "PASS loading visuals: logo/centering, tabs, page blur, input blocking, tokens, failure/cancel/ready/home cleanup, light theme, reduced motion, cache-hit delay, mount recovery",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
