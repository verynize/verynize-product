// UI-ready signal (web/src/lib/bridge.ts, contract in web/src/islands/README.md): on a fresh launch and after a reload
// `html[data-ui-ready]` / `bd:ui-ready` fire exactly once, and at that moment the taken-over shell controls
// (#files-home, #add-page, …) resolve to the visible island elements, not to legacy elements parked in #bd-legacy-dock.
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");

// Runs in the page: the state of the shell controls right now.
function snapshot() {
  const dock = document.getElementById("bd-legacy-dock");
  const control = (id) => {
    const all = document.querySelectorAll(`[id="${id}"]`);
    const el = all[0];
    const rect = el?.getBoundingClientRect();
    return {
      count: all.length,
      inDock: !!el && !!dock?.contains(el),
      island: !!el?.closest("[data-island]"),
      visible:
        !!el &&
        el.checkVisibility({ visibilityProperty: true }) &&
        rect.width > 0 &&
        rect.height > 0,
    };
  };
  return {
    home: document.body.classList.contains("files-view"),
    attribute: document.documentElement.dataset.uiReady,
    chrome: document.body.classList.contains("bd-chrome"),
    filesHome: control("files-home"),
    addPage: control("add-page"),
    // Every element parked in the dock must have handed its id over (renamed `legacy-<id>`).
    dockIds: [...(dock?.querySelectorAll("[id]") ?? [])]
      .map((el) => el.id)
      .filter((id) => !id.startsWith("legacy-")),
    pending: window.__bdPendingTakeovers?.(),
  };
}

function assertReady(state, when) {
  assert.equal(state.attribute, "true", `${when}: html[data-ui-ready] is set before bd:ui-ready`);
  assert.equal(state.chrome, true, `${when}: the chrome island has mounted`);
  for (const [name, control] of Object.entries({
    "#files-home": state.filesHome,
    "#add-page": state.addPage,
  })) {
    assert.deepEqual(
      control,
      { count: 1, inDock: false, island: true, visible: name !== "#add-page" || !state.home },
      `${when}: ${name} is the visible island element`,
    );
  }
  assert.deepEqual(
    state.dockIds.filter((id) => !state.pending.deferred.includes(id)),
    [],
    `${when}: no blocking control remains parked`,
  );
  assert.deepEqual(state.pending.islands, [], `${when}: every island has committed`);
  assert.deepEqual(state.pending.ids, [], `${when}: no takeOver id is pending`);
}

(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/ui-ready-`);
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    const warnings = [];
    page.on("console", (message) => {
      if (/UI not ready/.test(message.text())) warnings.push(message.text());
    });

    // 1. Fresh launch: the state when the event fires (or now, if it already fired before we could listen).
    const launch = await page.evaluate(
      (source) =>
        new Promise((resolve) => {
          // oxlint-disable-next-line typescript/no-implied-eval -- rebuilds the serialized snapshot function in the page
          const snap = new Function(`return (${source})()`);
          if (document.documentElement.dataset.uiReady === "true")
            resolve({ late: true, ...snap() });
          else
            window.addEventListener("bd:ui-ready", () => resolve({ late: false, ...snap() }), {
              once: true,
            });
        }),
      snapshot.toString(),
    );
    assertReady(launch, "fresh launch");
    await waitForUiReady(page);
    assert.equal(await page.locator("#files-home").isVisible(), true);
    assert.equal(await page.locator("#add-page").isVisible(), false);
    assert.equal(await page.locator("#file-home").isVisible(), true);

    // 2. Reload with a listener installed before any script: the event fires exactly once, with the same guarantees.
    await page.addInitScript((source) => {
      window.__uiReadyEvents = [];
      window.addEventListener("bd:ui-ready", () => {
        // oxlint-disable-next-line typescript/no-implied-eval -- rebuilds the serialized snapshot function in the page
        window.__uiReadyEvents.push(new Function(`return (${source})()`)());
      });
    }, snapshot.toString());
    await page.reload();
    await waitForUiReady(page);
    // Let late island work (lazy panels, legacy renders) run; the signal must not fire again.
    await page.waitForTimeout(1000);
    const events = await page.evaluate(() => window.__uiReadyEvents);
    assert.equal(events.length, 1, "bd:ui-ready fires once per page load");
    assertReady(events[0], "reload");

    // 3. The controls work right away: #add-page adds a page, #files-home opens the Files home.
    await page.locator(".file-open").first().click();
    const pages = () => page.evaluate(() => window.design.getDocument().pages.length);
    const before = await pages();
    await page.locator("#add-page").click();
    assert.equal(await pages(), before + 1);
    await page.locator("#files-home").click();
    await page.waitForFunction(() => document.body.classList.contains("files-view"));

    assert.deepEqual(warnings, [], "no UI-not-ready warning");
    console.log("ui-ready: ok");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
