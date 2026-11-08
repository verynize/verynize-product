const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-window-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.design);
    const initial = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        normal: window.getNormalBounds(),
        work: screen.getDisplayMatching(window.getBounds()).workArea,
        resizable: window.isResizable(),
        maximizable: window.isMaximizable(),
        fullscreenable: window.isFullScreenable(),
      };
    });
    assert.ok(initial.resizable && initial.maximizable && initial.fullscreenable);
    assert.ok(
      initial.normal.y >= initial.work.y &&
        initial.normal.y + initial.normal.height <= initial.work.y + initial.work.height,
      "normal bounds fit the usable display instead of retaining an oversized off-screen height",
    );
    await app.evaluate(({ BrowserWindow }, work) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setBounds({ ...work, height: Math.max(600, work.height - 120) });
      window.setBounds(work);
    }, initial.work);
    // X11 applies geometry requests asynchronously (through the window manager); macOS already has them here.
    // Linux CI runs X11 under xvfb with no window manager: the work area is the whole screen and the X server
    // reports the window 1 DIP short of a full-screen-height request (1079 of 1080). That still shows what this
    // test guards (the window reaches the screen bottom, not an old oversized or clamped height), so Linux
    // accepts 1 DIP; macOS stays exact.
    const slack = process.platform === "linux" ? 1 : 0;
    const reaches = (bounds) =>
      Math.abs(bounds.y + bounds.height - (initial.work.y + initial.work.height)) <= slack;
    const bottom = async () => {
      let bounds;
      for (let i = 0; i < 40; i++) {
        bounds = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getBounds(),
        );
        if (bounds.y + bounds.height === initial.work.y + initial.work.height) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return bounds;
    };
    const resized = await bottom();
    assert.ok(
      reaches(resized),
      `resizing reaches the bottom of the work area: ${resized.y + resized.height} vs ${initial.work.y + initial.work.height}`,
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    const maximized = await bottom();
    assert.ok(
      reaches(maximized),
      `maximizing fills the usable screen height: ${maximized.y + maximized.height} vs ${initial.work.y + initial.work.height}`,
    );
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector("body > main").getBoundingClientRect().bottom - innerHeight,
        ) < 2,
    );
    console.log(
      "PASS window layout: normal bounds on-screen, vertical resize, maximize and full-height renderer",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
