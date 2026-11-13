// Components UI in the real app (design/component-audit/README.md "UI"): ⌥⌘K on a frame and on several layers (one
// undo step), layer-row roles, the inspector's Component / Instance sections (Create instance, Reset overrides,
// Go to main component across pages, Detach), ⌥⌘B, Convert to slot / Remove slot from the context menu, the
// Components panel (click and drag insert an instance, search), the App shell preset with two instances whose
// Content slots hold different pages and keep them through an edit of the main's header, the canvas chrome
// attributes, and the cycle guard (move, paste and canvas drop into a main the instance depends on are refused).
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
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
const rect = (id, extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  parentId: null,
  x: 0,
  y: 0,
  w: 60,
  h: 40,
  color: "#7555c8",
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "components-ui-"));
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
    await moveOffCursor(app);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await waitForUiReady(page);
    const doc = () => page.evaluate(() => window.design.getDocument());
    const node = async (id) => (await doc()).pages.flatMap((p) => p.nodes).find((n) => n.id === id);
    const select = (ids) => page.evaluate((ids) => window.design.setSelection(ids), ids);
    const selection = () => page.evaluate(() => window.design.getSelection());
    const derived = (root, source) =>
      page.evaluate(([r, s]) => window.VerynizeComponents.derivedId(r, s), [root, source]);
    const row = (id) => page.locator(`#bd-layer-tree .layer-row[data-id="${id}"]`);
    const undo = () => page.evaluate(() => document.getElementById("undo").click());
    const menuItem = (command) =>
      page.locator(`[data-bd-context-menu] [data-command="${command}"]`).first();
    // Shortcuts go to the canvas: nothing focused (an inspector field or a row would take the keys).
    const press = async (combo) => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press(combo);
    };
    const toast = (text) => page.locator("[data-sonner-toast]", { hasText: text });

    await page.evaluate(
      ([nodes]) => {
        const d = window.design.getDocument();
        d.pages = [
          { id: "p1", name: "Desktop", nodes },
          { id: "p2", name: "Second", nodes: [] },
        ];
        d.activePage = "p1";
        window.design.setDocument(d);
        window.design.setCamera(40, 40, 0.5);
      },
      [
        [
          frame("card"),
          text("title", "card", "Title"),
          frame("content", { parentId: "card", y: 60, h: 160, color: "#f4f4f4" }),
          rect("r1", { x: 600, y: 0 }),
          rect("r2", { x: 700, y: 0 }),
        ],
      ],
    );

    // ---- ⌥⌘K on one frame: it becomes a main; the layer row and the canvas carry the role.
    await select(["card"]);
    await press(mod("Alt+KeyK"));
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[0].component === true,
    );
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("files-view")),
      false,
      "⌥⌘K is not ⌘K (Files)",
    );
    await row("card").waitFor();
    assert.equal(
      await row("card").getAttribute("data-role"),
      "main",
      "layer row shows the main role",
    );
    assert.equal(
      await page.locator('#canvas .layer[data-id="card"]').getAttribute("data-component"),
      "main",
    );
    assert.equal(await page.locator("#component-section h3").first().textContent(), "Component");

    // ---- ⌥⌘K on several layers: framed first, then made a main, in one undo step.
    await select(["r1", "r2"]);
    await press(mod("Alt+KeyK"));
    await page.waitForFunction(() => {
      const id = window.design.getSelection()[0];
      return id && window.design.components.info(id)?.role === "main";
    });
    const wrapped = (await selection())[0];
    assert.equal((await node("r1")).parentId, wrapped, "the layers were framed");
    assert.equal((await node(wrapped)).name, "Component");
    await undo();
    await page.waitForFunction(
      (id) => !window.design.getDocument().pages[0].nodes.some((n) => n.id === id),
      wrapped,
    );
    assert.equal((await node("r1")).parentId, null, "one undo removes the frame and the main");

    // ---- Inspector: Create instance on the main.
    await select(["card"]);
    await page.locator("#component-create-instance").click();
    await page.waitForFunction(
      () => window.design.components.info(window.design.getSelection()[0])?.role === "instance",
    );
    const i1 = (await selection())[0];
    assert.equal((await node(i1)).instanceOf, "card");
    assert.equal(await row(i1).getAttribute("data-role"), "instance");
    assert.equal(
      await page.locator(`#canvas .layer[data-id="${i1}"]`).getAttribute("data-component"),
      "instance",
    );
    assert.equal(await page.locator("#component-section h3").first().textContent(), "Instance");
    assert.match(await page.locator("#component-go-to-main").textContent(), /card/);
    assert.equal((await page.locator("#component-reset").textContent()).trim(), "No overrides");

    // ---- An override, counted and reset from the inspector.
    const title1 = await derived(i1, "title");
    await select([title1]); // reveals the instance's layers in the tree
    assert.equal(await row(title1).getAttribute("data-role"), "inherited");
    assert.equal(
      await page.locator("#component-section h3").first().textContent(),
      "Instance layer",
    );
    await page.evaluate((id) => window.design.updateNodes([id], { text: "Mine" }), title1);
    await select([i1]);
    await page.waitForFunction(() =>
      /Reset overrides \(1\)/.test(document.getElementById("component-reset")?.textContent || ""),
    );
    await page.locator("#component-reset").click();
    await page.waitForFunction(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id).text === "Title",
      title1,
    );

    // ---- Main inspector: instance count; context menu on an instance row.
    await select(["card"]);
    assert.equal(await page.locator("#component-instance-count").textContent(), "1 instance");
    await select([i1]);
    await row(i1).click({ button: "right" });
    await menuItem("component.goToMain").waitFor();
    assert.equal(
      await menuItem("component.detach").isVisible(),
      true,
      "row menu lists Detach instance",
    );
    await page.keyboard.press("Escape");

    // ---- Components panel: click inserts an instance on the active page (here: the second page); Go to main
    // component from there switches page, selects the main and zooms to it.
    await page.evaluate(() => window.design.setActivePage("p2"));
    await page.locator("#components-panel button[aria-controls=bd-components-body]").click();
    await page.locator('[data-component-card="card"]').click();
    await page.waitForFunction(() => {
      const d = window.design.getDocument();
      return d.activePage === "p2" && d.pages[1].nodes.some((n) => n.instanceOf === "card");
    });
    const onSecond = (await selection())[0];
    assert.equal((await doc()).pages[1].nodes.find((n) => n.id === onSecond).instanceOf, "card");
    await page.locator("#component-go-to-main").click();
    await page.waitForFunction(() => window.design.getDocument().activePage === "p1");
    assert.deepEqual(await selection(), ["card"], "Go to main component selects the main");
    // Search filters the list.
    await page.locator('#components-panel [aria-label="Search components"]').first().click();
    await page.locator("#components-search").fill("zzz");
    await page.locator("#components-panel").getByText("No matching components").waitFor();
    await page.locator("#components-search").fill("car");
    await page.locator('[data-component-card="card"]').waitFor();

    // ---- Drag a component card onto the canvas: an instance at the drop point.
    const before = (await doc()).pages[0].nodes.filter(
      (n) => n.instanceOf === "card" && n.sourceId === "card",
    ).length;
    await page.locator('[data-component-card="card"]').dragTo(page.locator("#canvas-wrap"), {
      targetPosition: { x: 700, y: 500 },
    });
    await page.waitForFunction(
      (n) =>
        window.design
          .getDocument()
          .pages[0].nodes.filter((x) => x.instanceOf === "card" && x.sourceId === "card").length ===
        n + 1,
      before,
    );
    const dropped = (await selection())[0];
    const at = await page.evaluate(() => {
      const r = document.getElementById("canvas-wrap").getBoundingClientRect();
      return window.design.screenToWorld(r.left + 700, r.top + 500);
    });
    const droppedNode = await node(dropped);
    assert.ok(
      Math.abs(droppedNode.x + droppedNode.w / 2 - at.x) <= 1 &&
        Math.abs(droppedNode.y + droppedNode.h / 2 - at.y) <= 1,
      "centred on the drop point",
    );

    // ---- ⌥⌘B detaches the selected instance.
    await select([dropped]);
    await press(mod("Alt+KeyB"));
    await page.waitForFunction(
      (id) => !window.design.getDocument().pages[0].nodes.find((n) => n.id === id).instanceOf,
      dropped,
    );
    assert.equal(
      await row(dropped).getAttribute("data-role"),
      null,
      "a detached instance is a plain frame",
    );

    // ---- Convert to slot / Remove slot from the layer-row context menu.
    await select(["content"]);
    await row("content").click({ button: "right" });
    await menuItem("component.convertToSlot").click();
    await page.waitForFunction(
      () =>
        window.design.getDocument().pages[0].nodes.find((n) => n.id === "content").slot === true,
    );
    assert.equal(await row("content").getAttribute("data-role"), "slot");
    assert.equal(await page.locator("#component-section h3").first().textContent(), "Slot");
    await row("content").click({ button: "right" });
    await menuItem("component.removeSlot").click();
    await page.waitForFunction(
      () => !window.design.getDocument().pages[0].nodes.find((n) => n.id === "content").slot,
    );
    await page.locator("#component-convert-slot").click(); // and back, from the inspector
    await page.waitForFunction(
      () =>
        window.design.getDocument().pages[0].nodes.find((n) => n.id === "content").slot === true,
    );

    // ---- Cycle guard: an instance of Card cannot go into Card (layer move, paste into the main, canvas drop).
    const moved = await page.evaluate(
      (id) => window.design.moveNodes([id], "content", "inside"),
      i1,
    );
    assert.equal(moved, null, "moveNodes refuses the cycle");
    assert.equal((await node(i1)).parentId, null);
    await toast("cannot contain an instance of itself").first().waitFor();
    await select([i1]);
    await press(mod("KeyC"));
    await select(["card"]);
    await page.evaluate(() => window.design.runCommand("edit.paste", { menu: true }));
    await page.waitForTimeout(300);
    const inCard = (await doc()).pages[0].nodes.filter(
      (n) => n.parentId === "card" && n.instanceOf === "card",
    );
    assert.equal(inCard.length, 0, "paste into the main is refused");
    assert.equal(
      (await page.evaluate(() => window.design.components.problems())).length,
      0,
      "no cycle was made",
    );

    // ---- App shell preset: two instances with different Content, then a header edit on the main.
    await page.locator("#components-search").fill("");
    await page.locator("#components-preset-app-shell").click();
    await page.waitForFunction(
      () =>
        window.design.components.info(window.design.getSelection()[0])?.mainName === "App Shell",
    );
    const shell = (await selection())[0];
    const shellNodes = (await doc()).pages[0].nodes;
    const byName = (name) =>
      shellNodes.find(
        (n) =>
          n.name === name && (n.parentId === shell || shellNodes.some((p) => p.id === n.parentId)),
      );
    const header = shellNodes.find((n) => n.parentId === shell && n.name === "Header");
    const titleId = shellNodes.find((n) => n.parentId === header.id && n.name === "Title").id;
    const slot = shellNodes.find((n) => n.slot === true && n.slotName === "Content");
    assert.ok(byName("Sidebar") && slot, "App shell has a sidebar and a Content slot");
    assert.deepEqual(
      (await page.evaluate((id) => window.design.components.info(id), shell)).slots.map(
        (s) => s.name,
      ),
      ["Content"],
    );
    const instances = [];
    for (const [i, label] of ["Page A content", "Page B content"].entries()) {
      await select([shell]);
      await page.locator("#component-create-instance").click();
      await page.waitForFunction(
        (n) =>
          window.design
            .getDocument()
            .pages[0].nodes.filter(
              (x) => x.instanceOf && x.sourceId === x.instanceOf && x.instanceOf === n,
            ).length > 0,
        shell,
      );
      const id = (await selection())[0];
      await page.evaluate(
        ([id, i]) => window.design.updateNodes([id], { y: (i + 1) * 900 }),
        [id, i],
      );
      const slotId = await derived(id, slot.id);
      await page.evaluate(
        ([slotId, label]) =>
          window.design.addNode("text", {
            parentId: slotId,
            text: label,
            name: label,
            fontSize: 24,
            color: "#24232b",
            wMode: "hug",
            hMode: "hug",
          }),
        [slotId, label],
      );
      instances.push({ id, slotId, label });
    }
    await select([instances[0].id]);
    await page.locator('#component-section [data-slot-state="modified"]').waitFor();
    assert.equal((await node(instances[0].slotId)).overrides.includes("children"), true);

    await page.evaluate(
      ([header, title]) => {
        window.design.updateNodes([header], { color: "#ede9fe" });
        window.design.updateNodes([title], { text: "Acme Cloud" });
      },
      [header.id, titleId],
    );
    for (const { id, slotId, label } of instances) {
      const headerCopy = await node(await derived(id, header.id));
      const titleCopy = await node(await derived(id, titleId));
      assert.equal(headerCopy.color, "#ede9fe", "the header edit reaches every instance");
      assert.equal(titleCopy.text, "Acme Cloud");
      const kids = (await doc()).pages[0].nodes.filter((n) => n.parentId === slotId);
      assert.deepEqual(
        kids.map((n) => n.text),
        [label],
        "each instance keeps its own page content",
      );
    }
    // Reset the slot from the instance inspector: back to Default, local content gone.
    await select([instances[1].id]);
    await page
      .locator(`#component-section [data-slot-row="${instances[1].slotId}"] button`)
      .click();
    await page.waitForFunction(
      (id) => !window.design.getDocument().pages[0].nodes.some((n) => n.parentId === id),
      instances[1].slotId,
    );
    await select([instances[1].id]);
    await page.locator('#component-section [data-slot-state="default"]').waitFor();

    // ---- Canvas drag of an instance onto its own main is refused (it stays put).
    const inst = instances[0].id;
    await select([inst]);
    await page.evaluate(() => window.design.setCamera(40, 40, 0.25));
    await page.waitForTimeout(100);
    const box = await page.locator(`#canvas .layer[data-id="${inst}"]`).boundingBox();
    const target = await page.locator(`#canvas .layer[data-id="${slot.id}"]`).boundingBox();
    await page.mouse.move(box.x + 30, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert.notEqual((await node(inst)).parentId, slot.id, "the drag did not enter the main");
    assert.equal((await page.evaluate(() => window.design.components.problems())).length, 0);

    // ---- Command palette and shortcuts drawer list the component commands.
    const ids = await page.evaluate(() => window.design.commands().map((c) => c.id));
    for (const id of [
      "component.create",
      "component.instance",
      "component.goToMain",
      "component.reset",
      "component.detach",
      "component.convertToSlot",
      "component.removeSlot",
    ])
      assert.ok(ids.includes(id), id);

    assert.deepEqual(errors, []);
    console.log("components UI: ok");
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
