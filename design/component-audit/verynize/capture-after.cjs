// Verynize side of the component audit after phase B1 (design/component-audit/README.md "UI"): drives the real
// Electron app with Playwright `_electron` in a temp --user-data-dir (never a real profile), 1440×870 content at the
// display's scale factor, and saves the screenshots to ./after/:
//
//   01-layers-main-instance   App Shell main + instances: layer rows with main / instance / slot icons and colours
//   02-inspector-main         the main selected: Component section (Create instance, instance count, slots)
//   03-inspector-instance     an instance with a Modified Content slot: Instance section, badges, Reset, Detach
//   04-components-panel       the Components panel: presets, search, thumbnails
//   05-shell-before-edit      two instances with different page content
//   06-shell-after-edit       the same after editing the main's header (fill and title): both follow, content kept
//   07-slot-selected          a slot of an instance selected: pink outline, slot inspector; an empty slot shows "+"
//   08-instance-menu          the instance's context menu (Create instance, Go to main, Reset, Detach)
//
//   npm run build:ui
//   node design/component-audit/verynize/capture-after.cjs
const ROOT = require("node:path").resolve(__dirname, "../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const { waitForUiReady } = require(ROOT + "/tests/helpers/ui-ready.cjs");
const { moveOffCursor } = require(ROOT + "/tests/helpers/off-cursor.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const OUT = path.join(__dirname, "after");

(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vz-component-after-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({
    env,
    cwd: ROOT,
    args: ["--use-mock-keychain", ".", `--user-data-dir=${profile}`],
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    await moveOffCursor(app);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await waitForUiReady(page);
    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(OUT, name + ".png") });
      console.log("saved", name);
    };
    const select = (ids) => page.evaluate((ids) => window.design.setSelection(ids), ids);
    const derived = (root, source) =>
      page.evaluate(([r, s]) => window.VerynizeComponents.derivedId(r, s), [root, source]);
    const nodes = () => page.evaluate(() => window.design.getDocument().pages[0].nodes);

    // A clean file with one page.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.name = "Component demo";
      d.pages = [{ id: "app", name: "App", nodes: [] }];
      d.activePage = "app";
      window.design.setDocument(d);
    });

    // App shell preset → main; three instances (two filled with different pages, one left empty).
    await page.locator("#components-panel button[aria-controls=bd-components-body]").click();
    await page.locator("#components-preset-app-shell").click();
    const main = await page.evaluate(() => window.design.getSelection()[0]);
    await page.evaluate((id) => window.design.updateNodes([id], { x: 0, y: 0 }), main);
    const all = await nodes();
    const header = all.find((n) => n.parentId === main && n.name === "Header");
    const title = all.find((n) => n.parentId === header.id && n.name === "Title");
    const slot = all.find((n) => n.slot === true);
    const instances = [];
    for (const [x, y] of [
      [1400, 0],
      [1400, 900],
      [0, 900],
    ]) {
      const id = await page.evaluate(
        ([main, x, y]) => window.design.components.instance(main, { parentId: null, x, y }),
        [main, x, y],
      );
      instances.push(id);
    }
    const fill = async (instance, heading, body, tint) => {
      const slotId = await derived(instance, slot.id);
      await page.evaluate(
        ([slotId, heading, body, tint]) => {
          const add = (type, extra) => window.design.addNode(type, { parentId: slotId, ...extra });
          add("text", {
            name: "Heading",
            text: heading,
            fontSize: 40,
            fontWeight: "600",
            color: "#24232b",
            wMode: "hug",
            hMode: "hug",
          });
          add("text", {
            name: "Lead",
            text: body,
            fontSize: 18,
            color: "#797581",
            wMode: "hug",
            hMode: "hug",
          });
          add("rectangle", {
            name: "Card",
            w: 600,
            h: 260,
            wMode: "fill",
            color: tint,
            radius: 16,
          });
        },
        [slotId, heading, body, tint],
      );
      return slotId;
    };
    const slotA = await fill(instances[0], "Overview", "Page A: this week at a glance", "#e5dbef");
    await fill(instances[1], "Projects", "Page B: everything in flight", "#f0d2ad");
    await page.evaluate(() => window.design.zoomToFit());

    // Expand the tree: reveal an inherited layer of instance A and the slot content, then select the main.
    await select([await derived(instances[0], title.id)]);
    await select([slotA]);
    await select([main]);
    await shot("01-layers-main-instance");
    await shot("02-inspector-main");

    await select([instances[0]]);
    await shot("03-inspector-instance");

    await page.locator('#components-panel [aria-label="Search components"]').first().click();
    await page.locator("#components-search").fill("shell");
    await page.locator("#components-preset-page-shell").click();
    const pageShell = await page.evaluate(() => window.design.getSelection()[0]);
    await page.evaluate((id) => window.design.updateNodes([id], { x: 2800, y: 0 }), pageShell);
    await page.evaluate(() => window.design.zoomToFit());
    await select([instances[0]]);
    await shot("04-components-panel");
    await page.locator('#components-panel [aria-label="Search components"]').first().click();
    await page.evaluate((id) => {
      window.design.setSelection([id]);
      window.design.runCommand("edit.delete");
    }, pageShell);
    await page.evaluate(() => window.design.zoomToFit());

    await select([]);
    await shot("05-shell-before-edit");
    await page.evaluate(
      ([header, title]) => {
        window.design.updateNodes([header], { color: "#24232b" });
        window.design.updateNodes([title], { text: "Acme Cloud", color: "#ffffff" });
      },
      [header.id, title.id],
    );
    await select([header.id]);
    await shot("06-shell-after-edit");

    await select([slotA]);
    await shot("07-slot-selected");

    await select([instances[0]]);
    await select([]);
    const box = await page
      .locator(`#canvas-overlay .frame-label[data-id="${instances[0]}"]`)
      .boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page.waitForSelector("#canvas-menu");
    await shot("08-instance-menu");
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
