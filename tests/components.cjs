// Components, instances and slots in the real app (web/component-core.js wired into web/app.js render()): create a
// main and an instance, override the instance (an inspector-style edit and an in-place keyboard nudge), edit the
// main (fill and text reach the instance, its override stays), slot content that survives main edits, delete of an
// inherited layer (hidden instead), ⌘D of a main (an instance), undo/redo of synced edits as one step each, and
// persistence across a reload.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

const frame = (id, extra = {}) => ({
  id,
  type: "frame",
  name: id,
  parentId: null,
  x: 0,
  y: 0,
  w: 320,
  h: 240,
  color: "#ffffff",
  layout: "free",
  radius: 0,
  ...extra,
});
const text = (id, parentId, value, extra = {}) => ({
  id,
  type: "text",
  name: id,
  parentId,
  x: 16,
  y: 16,
  w: 200,
  h: 30,
  color: "#25252e",
  text: value,
  textRuns: [],
  fontSize: 18,
  ...extra,
});

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "components-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: ["--use-mock-keychain", ".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await waitForUiReady(page);
    const doc = () => page.evaluate(() => window.design.getDocument());
    const node = async (id) => (await doc()).pages.flatMap((p) => p.nodes).find((n) => n.id === id);
    const update = (ids, patch) =>
      page.evaluate(([ids, patch]) => window.design.updateNodes(ids, patch), [ids, patch]);
    const derived = (root, source) =>
      page.evaluate(([r, s]) => window.VerynizeComponents.derivedId(r, s), [root, source]);
    const undo = () => page.evaluate(() => document.getElementById("undo").click());
    const redo = () => page.evaluate(() => document.getElementById("redo").click());

    await page.evaluate(
      ([nodes]) => {
        const d = window.design.getDocument();
        d.pages = [{ id: d.pages[0].id, name: "Desktop", nodes }];
        d.activePage = d.pages[0].id;
        window.design.setDocument(d);
        window.design.setCamera(40, 40, 0.5);
      },
      [
        [
          frame("card"),
          text("title", "card", "Title"),
          frame("content", { parentId: "card", y: 60, w: 320, h: 160, color: "#f4f4f4" }),
          text("placeholder", "content", "Drop content here"),
        ],
      ],
    );

    // ---- main → instance ----
    await page.evaluate(() => {
      window.design.components.create("card");
      window.design.components.setSlot("content", true, "Content");
    });
    const instance = await page.evaluate(() =>
      window.design.components.instance("card", { x: 420, y: 0 }),
    );
    const title = await derived(instance, "title"),
      slot = await derived(instance, "content"),
      placeholder = await derived(instance, "placeholder");
    assert.equal((await node(instance)).instanceOf, "card");
    assert.equal((await node(title)).text, "Title");
    assert.ok(
      await page.$(`#canvas [data-id="${title}"]`),
      "the instance's layers are on the canvas",
    );
    assert.equal(
      (await page.evaluate((id) => window.design.components.info(id), instance)).role,
      "instance",
    );
    console.log("PASS create main component and instance");

    // ---- overrides: an inspector-style edit and an in-place keyboard nudge ----
    await update([title], { text: "Hello" });
    assert.deepEqual((await node(title)).overrides, ["text"]);
    await page.evaluate((id) => {
      window.design.setSelection([id]);
      document.activeElement?.blur?.();
    }, title);
    await page.keyboard.press("ArrowRight");
    assert.equal((await node(title)).x, 17);
    assert.deepEqual((await node(title)).overrides, ["text", "x"]);
    console.log("PASS instance edits become overrides");

    // ---- main edits propagate, overrides stay ----
    await update(["card"], { color: "#ff0000" });
    await update(["title"], { text: "New title", color: "#0000ff" });
    assert.equal((await node(instance)).color, "#ff0000");
    assert.equal((await node(title)).text, "Hello");
    assert.equal((await node(title)).color, "#0000ff");
    const fill = await page.evaluate(
      (id) => getComputedStyle(document.querySelector(`#canvas [data-id="${id}"]`)).backgroundColor,
      instance,
    );
    assert.equal(fill, "rgb(255, 0, 0)", "the instance renders the main's new fill");
    console.log("PASS main fill and text reach the instance; its text override stays");

    // ---- undo/redo: the main edit and its propagation are one step ----
    await undo();
    assert.equal((await node("title")).text, "Title");
    assert.equal((await node(title)).color, "#25252e");
    await redo();
    assert.equal((await node("title")).text, "New title");
    assert.equal((await node(title)).color, "#0000ff");
    assert.equal((await node(title)).text, "Hello");
    console.log("PASS undo/redo of a main edit");

    // ---- slots ----
    await page.evaluate((id) => window.design.setSelection([id]), slot);
    const local = await page.evaluate(
      (id) => window.design.addNode("text", { parentId: id, text: "Dashboard", name: "Dashboard" }),
      slot,
    );
    assert.deepEqual((await node(slot)).overrides, ["children"]);
    assert.equal((await node(placeholder)).sourceId, undefined, "Modified slot content is local");
    await update(["placeholder"], { text: "Main placeholder" });
    await update(["content"], { color: "#00ff00" });
    assert.equal((await node(local)).parentId, slot, "slot content survives the main edit");
    assert.equal((await node(placeholder)).text, "Drop content here");
    assert.equal(
      (await node(slot)).color,
      "#00ff00",
      "the slot frame itself still follows the main",
    );
    const slots = await page.evaluate((id) => window.design.components.info(id).slots, instance);
    assert.deepEqual(slots, [{ id: slot, name: "Content", state: "modified" }]);
    console.log("PASS slot content survives main edits");

    // ---- deleting an inherited layer hides it ----
    await page.evaluate((id) => window.design.setSelection([id]), title);
    await page.evaluate(() => window.design.runCommand("edit.delete"));
    assert.equal((await node(title)).hidden, true);
    assert.ok((await node(title)).overrides.includes("hidden"));
    console.log("PASS deleting an inherited layer hides it");

    // ---- ⌘D on a main makes an instance ----
    await page.evaluate(() => {
      window.design.setSelection(["card"]);
      document.activeElement?.blur?.();
    });
    await page.keyboard.press(mod("KeyD"));
    const copyId = (await page.evaluate(() => window.design.getSelection()))[0];
    const copy = await node(copyId);
    assert.equal(copy.instanceOf, "card");
    assert.equal(copy.component, undefined);
    assert.equal((await node(await derived(copyId, "title"))).text, "New title");
    console.log("PASS duplicating a main creates an instance");

    // ---- reload: links, overrides and slot content persist, and the sync keeps working ----
    await page.waitForTimeout(600);
    await page.reload();
    await waitForUiReady(page);
    assert.equal((await node(instance)).instanceOf, "card");
    assert.deepEqual((await node(title)).overrides, ["hidden", "text", "x"]);
    assert.equal((await node(local)).parentId, slot);
    await update(["card"], { color: "#123456" });
    assert.equal((await node(instance)).color, "#123456");
    assert.equal((await node(copyId)).color, "#123456");
    assert.equal((await node(local)).text, "Dashboard");
    console.log("PASS components persist across a reload");

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
