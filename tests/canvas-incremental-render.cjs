// Canvas rendering does only the work an edit needs: a drag moves the dragged layers without rendering the document
// (one render and one undo step at release), and a render redraws only the layer elements whose node changed, in place,
// with a canvas identical to a full rebuild after edits, selection, reorder, re-parenting, undo/redo, text editing,
// shaders, MCP live edits (real bridge) and cloud operations.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-incremental-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERYNIZE_DISABLE_MCP;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  env.VERYNIZE_PREFERENCES = path.join(dir, "design-preferences.json");
  let client;
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await moveOffCursor(app);
    await waitForUiReady(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("#canvas .layer");
    const near = (actual, expected, tolerance = 0.5, label = "") =>
      assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    async function seed(nodes, camera = [100, 100, 1]) {
      await page.evaluate(
        ([nodes, camera]) => {
          const d = window.design.getDocument();
          d.pages = [{ id: d.pages[0].id, name: "Desktop", nodes }];
          d.activePage = d.pages[0].id;
          window.design.setDocument(d);
          window.design.setSelection([]);
          window.design.setTool("move");
          window.design.setCamera(...camera);
        },
        [nodes, camera],
      );
    }
    async function screen(x, y) {
      return page.evaluate(
        ([x, y]) => {
          const r = document.querySelector("#canvas-wrap").getBoundingClientRect(),
            c = window.design.getCamera();
          return { x: r.left + c.x + x * c.zoom, y: r.top + c.y + y * c.zoom };
        },
        [x, y],
      );
    }
    // Renders are counted through document subscribers, which every render() notifies once.
    await page.evaluate(() => {
      window.__renders = 0;
      window.design.subscribe(() => {
        window.__renders++;
      });
    });
    const renders = () => page.evaluate(() => window.__renders);
    const rect = (id, x, y, w = 100, h = 80, extra = {}) => ({
      id,
      name: id,
      type: "rectangle",
      x,
      y,
      w,
      h,
      color: "#8844cc",
      ...extra,
    });
    const box = (id) =>
      page.evaluate((id) => {
        const r = document.querySelector(`#canvas [data-id="${id}"]`).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, id);
    // Element identity: every layer element is remembered by node id, then compared with what the canvas holds now.
    const tag = () =>
      page.evaluate(() => {
        window.__layers = new Map(
          [...document.querySelectorAll("#canvas .layer")].map((e) => [e.dataset.id, e]),
        );
      });
    const identity = () =>
      page.evaluate(() => {
        const out = { same: 0, replaced: [], gone: [] };
        for (const [id, el] of window.__layers) {
          const now = document.querySelector(`#canvas [data-id="${CSS.escape(id)}"]`);
          if (now === el) out.same++;
          else (now ? out.replaced : out.gone).push(id);
        }
        return out;
      });
    // Which layer elements a change wrote to (attributes, children or text), ignoring status the shader runtime and the
    // selection chrome keep up to date on their own.
    const watch = () =>
      page.evaluate(() => {
        const skip = new Set(["data-shader-status", "data-shader-kind", "data-clip-ring"]),
          touched = (window.__touched = new Set());
        const note = (rs) => {
          for (const r of rs) {
            if (r.type === "attributes" && skip.has(r.attributeName)) continue;
            const el = (r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest(
              "#canvas .layer",
            );
            if (el) touched.add(el.dataset.id);
          }
        };
        window.__watch?.disconnect();
        window.__watch = new MutationObserver(note);
        window.__watch.note = note;
        window.__watch.observe(document.querySelector("#canvas"), {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
      });
    const touched = () =>
      page.evaluate(() => {
        window.__watch.note(window.__watch.takeRecords());
        return [...window.__touched].sort();
      });
    // The canvas as markup, without what changes on its own (shader status and canvas sizes, the clip-proof ring).
    const markup = () =>
      page.evaluate(() => {
        const clone = document.querySelector("#canvas").cloneNode(true);
        for (const el of clone.querySelectorAll("*")) {
          for (const a of ["data-shader-status", "data-shader-kind", "data-clip-ring"])
            el.removeAttribute(a);
          if (el.tagName === "CANVAS") {
            el.removeAttribute("width");
            el.removeAttribute("height");
          }
        }
        return clone.innerHTML;
      });
    // The patched canvas must equal what a full rebuild (localStorage 'verynize.canvas-render' = 'full') draws.
    async function matchesFullRender(label) {
      const patched = await markup();
      await page.evaluate(() => {
        localStorage.setItem("verynize.canvas-render", "full");
        window.render();
        localStorage.removeItem("verynize.canvas-render");
      });
      assert.equal(patched, await markup(), `${label}: the patched canvas equals a full rebuild`);
      await page.evaluate(() => window.render());
      await tag();
    }
    async function edit(label, change, { only, kept = true } = {}) {
      await tag();
      await watch();
      await page.evaluate(change);
      if (only)
        assert.deepEqual(
          await touched(),
          only.toSorted(),
          `${label}: only these layer elements are written`,
        );
      const ids = await identity();
      if (kept)
        assert.deepEqual(
          [ids.replaced, ids.gone],
          [[], []],
          `${label}: no layer element is recreated`,
        );
      await matchesFullRender(label);
      return ids;
    }

    // ---- 1. Live drag: no render while the pointer moves, one render and one undo step at release ----
    await seed([
      {
        id: "F",
        name: "Frame",
        type: "frame",
        x: 600,
        y: 0,
        w: 300,
        h: 300,
        color: "#ffffff",
        layout: "free",
        clipContent: true,
      },
      rect("inside", 20, 20, 60, 40, { parentId: "F" }),
      rect("R", 0, 0, 100, 80),
      rect("anchor", 0, 400, 100, 80, { rotation: 30 }),
    ]);
    await page.evaluate(() => window.design.updateNodes(["inside"], { name: "inside" })); // a known previous undo step
    await page.evaluate(() => window.design.setSelection(["R"]));
    const start = await screen(50, 40),
      startBox = await box("R");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const before = await renders();
    await page.mouse.move(start.x + 120, start.y + 90, { steps: 12 });
    const during = await page.evaluate(() => ({
      n: window.design.getDocument().pages[0].nodes.find((n) => n.id === "R"),
      translate: document.querySelector("#canvas [data-id=R]").style.translate,
      renders: window.__renders,
    }));
    const heldBox = await box("R");
    assert.equal(during.renders - before, 0, "no render while the layer follows the pointer");
    near(during.n.x, 120, 0.01, "x follows the pointer live");
    near(during.n.y, 90, 0.01, "y follows the pointer live");
    near(heldBox.x - startBox.x, 120, 0.5, "the element is drawn where the pointer put it");
    near(heldBox.y - startBox.y, 90, 0.5);
    assert.ok(during.translate, "the element is offset by a translate while held");
    await page.mouse.up();
    assert.equal((await renders()) - before, 1, "one render at release");
    const dropped = await node("R");
    assert.deepEqual([dropped.x, dropped.y], [120, 90], "the drop lands where the pointer left it");
    assert.equal(
      await page.locator("#canvas [data-id=R]").evaluate((e) => e.style.translate),
      "",
      "the drag offset is gone after release",
    );
    assert.equal(
      await page.locator("#canvas [data-id=R]").evaluate((e) => e.style.left),
      "120px",
      "the layer is drawn from its new x",
    );
    await page.keyboard.press(mod("KeyZ"));
    assert.deepEqual(await node("R").then((n) => [n.x, n.y]), [0, 0], "the drag is one undo step");
    assert.equal((await node("inside")).name, "inside", "undo stops at the drag");
    await page.keyboard.press(mod("Shift+KeyZ"));
    assert.deepEqual(await node("R").then((n) => [n.x, n.y]), [120, 90], "redo replays the drag");

    // A rotated layer moves in its parent's space: the translate composes with its rotation.
    await page.evaluate(() => window.design.setSelection(["anchor"]));
    const a0 = await screen(50, 440),
      anchorBox = await box("anchor");
    await page.mouse.move(a0.x, a0.y);
    await page.mouse.down();
    await page.mouse.move(a0.x + 60, a0.y - 30, { steps: 6 });
    const anchorHeld = await box("anchor"),
      anchorLive = await node("anchor"); // snapping may adjust the pointer delta
    near(anchorHeld.x - anchorBox.x, anchorLive.x, 0.5, "rotated layer is drawn at its live x");
    near(
      anchorHeld.y - anchorBox.y,
      anchorLive.y - 400,
      0.5,
      "rotated layer is drawn at its live y",
    );
    near(anchorLive.x, 60, 6, "rotated layer follows the pointer");
    near(anchorLive.y, 370, 6);
    await page.mouse.up();
    assert.deepEqual(
      await node("anchor").then((n) => [n.x, n.y]),
      [anchorLive.x, anchorLive.y],
      "released where it was held",
    );
    const anchorAfter = await box("anchor");
    near(anchorAfter.x, anchorHeld.x, 0.5, "no jump on release");
    near(anchorAfter.y, anchorHeld.y, 0.5);

    // Nesting on the way still re-renders once, and the layer keeps following inside the frame.
    await page.evaluate(() => window.design.setSelection(["R"]));
    const r0 = await screen(170, 130),
      into = await screen(650, 120);
    await page.mouse.move(r0.x, r0.y);
    await page.mouse.down();
    await page.mouse.move(into.x, into.y, { steps: 10 });
    const nested = await page.evaluate(() => ({
      parent: window.design.getDocument().pages[0].nodes.find((n) => n.id === "R").parentId,
      dom: document.querySelector("#canvas [data-id=R]").parentElement.closest(".layer")?.dataset
        .id,
    }));
    assert.deepEqual(
      nested,
      { parent: "F", dom: "F" },
      "the layer nests while the pointer is over the frame",
    );
    await page.mouse.move(into.x + 20, into.y + 10, { steps: 4 });
    await page.mouse.up();
    const inF = await node("R");
    assert.equal(inF.parentId, "F");
    near(inF.x, 120 + 480 + 20 - 600, 0.5, "x is relative to the frame");
    near(inF.y, 90 - 10 + 10, 0.5);
    await page.keyboard.press(mod("KeyZ"));
    assert.equal((await node("R")).parentId, null, "nesting drag is one undo step");

    // Alt-drag moves a copy and leaves the original in place.
    await page.evaluate(() => window.design.setSelection(["R"]));
    const c0 = await screen(170, 130);
    await page.mouse.move(c0.x, c0.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(c0.x + 200, c0.y + 200, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    const copies = await page.evaluate(() =>
      window.design
        .getDocument()
        .pages[0].nodes.filter((n) => n.type === "rectangle" && /^R( \d+)?$/.test(n.name))
        .map((n) => [n.x, n.y]),
    );
    assert.deepEqual(
      copies.toSorted((a, b) => a[0] - b[0]),
      [
        [120, 90],
        [320, 290],
      ],
      "the original stays, the copy lands under the pointer",
    );

    // ---- 2. Keyed render: an edit redraws only its own element, in place ----
    const svg =
      "data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#91b3d5"/></svg>',
      ).toString("base64");
    await seed([
      {
        id: "F",
        name: "Frame",
        type: "frame",
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        color: "#ffffff",
        layout: "free",
        clipContent: true,
      },
      rect("c1", 20, 20, 60, 40, { parentId: "F" }),
      rect("c2", 100, 20, 60, 40, { parentId: "F" }),
      rect("c3", 180, 20, 60, 40, { parentId: "F", radius: 8 }),
      {
        id: "T",
        name: "Title",
        type: "text",
        parentId: "F",
        x: 20,
        y: 120,
        w: 300,
        h: 40,
        color: "#202030",
        text: "Hello world",
        fontSize: 24,
        textRuns: [{ start: 0, end: 5, bold: true, italic: false }],
      },
      {
        id: "I",
        name: "Icon",
        type: "image",
        parentId: "F",
        x: 20,
        y: 200,
        w: 40,
        h: 40,
        color: "transparent",
        src: svg,
      },
      {
        id: "S",
        name: "Stack",
        type: "frame",
        x: 450,
        y: 0,
        w: 300,
        h: 120,
        color: "#eeeeee",
        layout: "flex",
        direction: "row",
        gap: 10,
        padding: 10,
      },
      rect("k1", 0, 0, 60, 40, { parentId: "S" }),
      rect("k2", 0, 0, 60, 40, { parentId: "S" }),
      rect("k3", 0, 0, 60, 40, { parentId: "S" }),
      {
        id: "B",
        name: "Block",
        type: "frame",
        x: 450,
        y: 200,
        w: 300,
        h: 260,
        color: "#dddddd",
        layout: "block",
        gapY: 12,
        padding: 10,
      },
      rect("b1", 0, 0, 100, 30, { parentId: "B" }),
      rect("b2", 0, 0, 100, 30, { parentId: "B" }),
      rect("b3", 0, 0, 100, 30, { parentId: "B" }),
      rect("r1", 0, 400, 100, 80),
      rect("r2", 150, 400, 100, 80),
      rect("r3", 300, 400, 100, 80),
      {
        id: "G",
        name: "Glow",
        type: "shader",
        x: 800,
        y: 0,
        w: 200,
        h: 120,
        color: "#a58bdd",
        shaderPreset: "aurora",
        shaderSpeed: 1,
        shaderIntensity: 1,
      },
    ]);
    await matchesFullRender("seeded document");
    const layers = await page.locator("#canvas .layer").count();
    await edit("one fill", () => window.design.updateNodes(["c2"], { color: "#ff0000" }), {
      only: ["c2"],
    });
    assert.equal(
      await page.locator("#canvas [data-id=c2]").evaluate((e) => e.style.backgroundColor),
      "rgb(255, 0, 0)",
      "the edited layer shows its new fill",
    );
    await edit(
      "text and runs",
      () =>
        window.design.updateNodes(["T"], {
          text: "Hello there",
          textRuns: [{ start: 6, end: 11, bold: false, italic: true }],
        }),
      { only: ["T"] },
    );
    assert.equal(
      await page.locator("#canvas [data-id=T]").evaluate((e) => e.textContent),
      "Hello there",
    );
    await edit("move", () => window.design.updateNodes(["r2"], { x: 170 }), { only: ["r2"] });
    await edit("rename", () => window.design.updateNodes(["F"], { name: "Renamed" }), {
      only: ["F"],
    });
    await edit("selection", () => window.design.setSelection(["r1"]), { only: ["r1"] });
    assert.equal(
      await page.locator("#canvas [data-id=r1] > .handle").count(),
      4,
      "the selected layer gets its handles",
    );
    await edit("selection moves", () => window.design.setSelection(["c1", "T"]), {
      only: ["r1", "c1", "T"],
    });
    assert.equal(
      await page.locator("#canvas [data-id=r1] > .handle").count(),
      0,
      "the deselected layer loses its handles",
    );
    await edit("stack gap", () => window.design.updateNodes(["S"], { gap: 30 }));
    await edit("block gap (children margins)", () =>
      window.design.updateNodes(["B"], { gapY: 24 }),
    );
    await edit("last in-flow child changes", () =>
      window.design.updateNodes(["b3"], { hidden: true }),
    );
    await edit("shader colour", () => window.design.updateNodes(["G"], { color: "#33aa66" }), {
      only: ["G"],
    });
    assert.equal(
      await page.locator("#canvas [data-id=G] > canvas.shader-surface").count(),
      1,
      "the shader runs again in its redrawn layer",
    );
    await edit("locked", () => window.design.updateNodes(["k2"], { locked: true }), {
      only: ["k2"],
    });
    await edit("variables recolour every layer", () => {
      const d = window.design.getDocument();
      d.tokens = { ...d.tokens, brand: "#123456" };
      d.pages[0].nodes.find((n) => n.id === "r3").token = "brand";
      window.design.setDocument(d);
    });
    assert.equal(
      await page.locator("#canvas [data-id=r3]").evaluate((e) => e.style.backgroundColor),
      "rgb(18, 52, 86)",
    );
    // Structure: order, parent and type changes move elements; deletions remove theirs; nothing else is rebuilt.
    await edit("z-order", () => window.design.moveNodes(["r1"], "r3", "above"));
    assert.deepEqual(
      await page
        .locator("#canvas > .layer")
        .evaluateAll((els) => els.map((e) => e.dataset.id).filter((id) => id.startsWith("r"))),
      ["r2", "r3", "r1"],
      "canvas order follows the document",
    );
    await edit("re-parent", () => window.design.moveNodes(["r2"], "F", "inside"));
    assert.equal(
      await page.locator("#canvas [data-id=r2]").evaluate((e) => e.parentElement.dataset.id),
      "F",
      "the same element moved into its new parent",
    );
    const removed = await edit(
      "delete",
      () => {
        const d = window.design.getDocument();
        d.pages[0].nodes = d.pages[0].nodes.filter((n) => n.id !== "c3");
        window.design.setDocument(d);
      },
      { kept: false },
    );
    assert.deepEqual(
      [removed.replaced, removed.gone],
      [[], ["c3"]],
      "only the deleted layer leaves the canvas",
    );
    await edit("type change", () =>
      window.design.updateNodes(["c1"], { type: "text", text: "Now text" }),
    );
    const branch = await edit(
      "delete a frame with children",
      () => {
        const d = window.design.getDocument();
        d.pages[0].nodes = d.pages[0].nodes.filter((n) => n.id !== "S" && n.parentId !== "S");
        window.design.setDocument(d);
      },
      { kept: false },
    );
    assert.deepEqual(branch.gone.toSorted(), ["S", "k1", "k2", "k3"]);
    // Undo and redo replace the document with new objects: unchanged nodes keep their elements.
    await edit("undo", () => {
      const b = document.getElementById("undo");
      b.disabled = false;
      b.click();
    });
    assert.equal(
      await page.locator("#canvas [data-id=S] > [data-id=k1]").count(),
      1,
      "undo draws the frame and its children again",
    );
    const redone = await edit(
      "redo",
      () => {
        const b = document.getElementById("redo");
        b.disabled = false;
        b.click();
      },
      { kept: false },
    );
    assert.deepEqual(
      [redone.replaced, redone.gone.toSorted()],
      [[], ["S", "k1", "k2", "k3"]],
      "redo removes only the deleted branch",
    );
    assert.equal(
      await page.locator("#canvas .layer").count(),
      layers - 5,
      "every remaining layer is drawn once",
    );
    // A render with nothing changed writes nothing.
    await edit("no-op render", () => window.render(), { only: [] });

    // ---- 3. Writes from elsewhere are redrawn on the next render, as a full rebuild would ----
    await edit("foreign style write", () => {
      document.querySelector("#canvas [data-id=r1]").style.backgroundColor = "rgb(1, 2, 3)";
      window.render();
    });
    assert.notEqual(
      await page.locator("#canvas [data-id=r1]").evaluate((e) => e.style.backgroundColor),
      "rgb(1, 2, 3)",
      "a stray inline style is replaced from the node",
    );
    // In-canvas text editing keeps its element while typing (renders included) and ends on canonical spans.
    await page.evaluate(() => {
      window.design.setSelection(["T"]);
      window.design.runCommand("select.child");
    }); // Enter on a text layer
    await page.waitForSelector("#canvas [data-id=T][data-text-editing]");
    await page.keyboard.press(mod("KeyA"));
    await page.keyboard.type("Typed text");
    await page.evaluate(() => window.design.updateNodes(["r1"], { color: "#00ff00" })); // a render while typing
    assert.equal(
      await page.locator("#canvas [data-id=T][data-text-editing]").count(),
      1,
      "the editor survives a render",
    );
    await page.keyboard.press("Escape");
    assert.equal((await node("T")).text, "Typed text");
    assert.equal(
      await page
        .locator("#canvas [data-id=T] [data-run-bold], #canvas [data-id=T] [data-run-italic]")
        .count(),
      0,
      "editor spans are gone",
    );
    await matchesFullRender("after text editing");
    await page.evaluate(() => {
      window.design.setSelection(["T"]);
      window.design.runCommand("select.child");
    });
    await page.waitForSelector("#canvas [data-id=T][data-text-editing]");
    await page.keyboard.press("Escape"); // unchanged text: the plain render must still restore handles and spans
    assert.equal(
      await page.locator("#canvas [data-id=T] > .handle").count(),
      4,
      "handles come back after an unchanged edit",
    );
    await matchesFullRender("after an unchanged text edit");

    // ---- 4. Cloud operations and MCP live edits arrive as whole documents: unchanged layers keep their elements ----
    const viaOps = await edit(
      "cloud operations",
      () => {
        const before = window.design.getDocument(),
          after = structuredClone(before);
        after.pages[0].nodes.find((n) => n.id === "b1").color = "#0000ff";
        after.pages[0].nodes.push({
          ...after.pages[0].nodes.find((n) => n.id === "r1"),
          id: "remote",
          name: "remote",
          x: 600,
        });
        const ops = window.VerynizeOps.diff(before, after);
        window.design.setDocument(window.VerynizeOps.apply(before, ops).doc); // what web/cloud-panel.js apply() does
      },
      { only: ["b1", "T"] },
    ); // T loses its selection: setDocument clears it
    assert.equal(viaOps.replaced.length, 0);
    assert.equal(
      await page.locator("#canvas > [data-id=remote]").count(),
      1,
      "the remote layer is drawn",
    );
    assert.equal(
      await page.locator("#canvas [data-id=b1]").evaluate((e) => e.style.backgroundColor),
      "rgb(0, 0, 255)",
    );
    const file = path.join(dir, "mcp.json");
    let info;
    for (let i = 0; i < 100 && !info; i++) {
      try {
        info = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(info, "the MCP bridge is running");
    client = new Client({ name: "incremental-render-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(info.url), {
        requestInit: { headers: { Authorization: `Bearer ${info.token}` } },
      }),
    );
    const call = async (name, args = {}) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
      return JSON.parse(r.content[0].text);
    };
    await tag();
    const created = await call("create_artboard", {
      code: '<div data-node-label="Agent card" data-component-x="40" data-component-y="700" className="flex flex-col gap-2 p-4 w-[300px] bg-[#ffffff]"><h2 className="text-[#111111]">From the agent</h2></div>',
    });
    assert.equal(created.live, true);
    let ids = await identity();
    assert.deepEqual(
      [ids.replaced, ids.gone],
      [[], []],
      "an MCP edit keeps every existing element",
    );
    assert.equal(
      await page.locator('#canvas [data-name="Agent card"]').count(),
      1,
      "the agent artboard is drawn",
    );
    await matchesFullRender("MCP create");
    const heading = (await call("find_elements", { queries: [{ query: "from the agent" }] }))
      .matches[0].id;
    await watch();
    const report = await client.callTool({
      name: "update_elements",
      arguments: { edit: `{/* edit ${heading} */}<h2>Edited live</h2>` },
    });
    assert.match(report.content[0].text, /1 of 1 directives applied/);
    ids = await identity();
    assert.deepEqual([ids.replaced, ids.gone], [[], []], "an MCP update keeps every element");
    assert.ok(
      (await touched()).length <= 2,
      "an MCP update writes only the edited layer (and its hugging parent)",
    );
    assert.ok(
      (await page.locator("#canvas .layer", { hasText: "Edited live" }).count()) > 0,
      "the live edit is drawn",
    );
    await matchesFullRender("MCP update");

    // ---- 6. Offscreen artboards are culled (layout queries still answer) and come back when the camera reaches them ----
    const boardNodes = [];
    for (let i = 0; i < 8; i++)
      boardNodes.push(
        {
          id: "A" + i,
          name: "Board " + i,
          type: "frame",
          x: i * 1500,
          y: 0,
          w: 1200,
          h: 800,
          color: "#ffffff",
          layout: "free",
          clipContent: true,
        },
        rect("A" + i + "r", 100, 100, 200, 120, { parentId: "A" + i }),
        {
          id: "A" + i + "t",
          name: "t",
          type: "text",
          parentId: "A" + i,
          x: 100,
          y: 300,
          w: 10,
          h: 40,
          color: "#202030",
          text: "Board text " + i,
          fontSize: 24,
          wMode: "hug",
          hMode: "hug",
        },
      );
    boardNodes.push(
      {
        id: "U",
        name: "Unclipped",
        type: "frame",
        x: 9000,
        y: 0,
        w: 400,
        h: 300,
        color: "#eeeeee",
        layout: "free",
      },
      {
        id: "I",
        name: "Icon",
        type: "image",
        x: 0,
        y: 1000,
        w: 40,
        h: 40,
        color: "transparent",
        src: svg,
      },
    );
    await seed(boardNodes, [100, 100, 1]);
    const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    const culledNow = () =>
      page
        .locator("#canvas > .layer[data-culled]")
        .evaluateAll((els) => els.map((e) => e.dataset.id).sort());
    // Clipping boards entirely outside the view plus half a viewport on each side.
    const offscreen = () =>
      page.evaluate(() => {
        const r = document.querySelector("#canvas-wrap").getBoundingClientRect(),
          c = window.design.getCamera(),
          z = c.zoom,
          mx = r.width / z / 2,
          my = r.height / z / 2;
        const x0 = -c.x / z - mx,
          x1 = (r.width - c.x) / z + mx,
          y0 = -c.y / z - my,
          y1 = (r.height - c.y) / z + my;
        return window.design
          .getDocument()
          .pages[0].nodes.filter(
            (n) => !n.parentId && !(n.x + n.w >= x0 && n.x <= x1 && n.y + n.h >= y0 && n.y <= y1),
          )
          .map((n) => n.id)
          .sort();
      });
    await frame();
    let expected = await offscreen();
    assert.ok(
      expected.length >= 4 && !expected.includes("A0"),
      "the fixture has boards outside the view",
    );
    assert.deepEqual(
      await culledNow(),
      expected,
      "boards outside the view are culled, the rest are not",
    );
    assert.equal(
      await page.locator("#canvas [data-id=U]").evaluate((e) => e.hasAttribute("data-culled")),
      true,
      "an empty non-clipping frame is safely culled",
    );
    assert.equal(
      await page
        .locator("#canvas [data-id=A7]")
        .evaluate((e) => getComputedStyle(e).contentVisibility),
      "hidden",
    );
    // Geometry inside a culled board is still measured exactly (export, agents, snapping read it).
    const inside = await page.evaluate(() => {
      const w = document.querySelector("#canvas-wrap").getBoundingClientRect(),
        c = window.design.getCamera(),
        r = document.querySelector("#canvas [data-id=A7r]").getBoundingClientRect();
      return {
        x: (r.left - w.left - c.x) / c.zoom,
        y: (r.top - w.top - c.y) / c.zoom,
        w: r.width / c.zoom,
        h: r.height / c.zoom,
        hug: document.querySelector("#canvas [data-id=A7t]").offsetWidth,
      };
    });
    assert.deepEqual(
      [inside.x, inside.y, inside.w, inside.h],
      [7 * 1500 + 100, 100, 200, 120],
      "a layer in a culled board keeps its exact box",
    );
    assert.ok(inside.hug > 10, "hugging text in a culled board measures its content");
    const exported = await page.evaluate(async () => {
      window.design.setSelection(["A7r"]);
      const r = await window.design.exportArtwork({ format: "HTML", selectionOnly: true });
      return [r.width, r.height];
    });
    assert.deepEqual(exported, [200, 120], "a layer in a culled board exports at its size");
    assert.ok(!(await culledNow()).includes("A7"), "selection reveals its ancestor");
    await page.evaluate(() => window.design.setSelection([]));
    await matchesFullRender("culled boards");
    // A camera jump reveals the board it lands on and culls the ones it leaves.
    await page.evaluate(() => window.design.setCamera(-7 * 1500 + 100, 100, 1));
    await frame();
    expected = await offscreen();
    assert.ok(!expected.includes("A7") && expected.includes("A0"));
    assert.deepEqual(
      await culledNow(),
      expected,
      "after a camera jump the culled set follows the view",
    );
    const hit = await page.evaluate(() => {
      const r = document.querySelector("#canvas [data-id=A7r]").getBoundingClientRect();
      return document
        .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        .some((e) => e.dataset?.id === "A7r");
    });
    assert.ok(hit, "layers of a revealed board are hit-tested");
    await matchesFullRender("after a camera jump");
    // A wheel pan reveals boards as they come near (a few per step while it runs), every one once it settles.
    const wrapBox = await page.locator("#canvas-wrap").boundingBox();
    await page.mouse.move(wrapBox.x + wrapBox.width / 2, wrapBox.y + wrapBox.height / 2);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(-200, 0);
    await page.waitForTimeout(400);
    assert.deepEqual(
      await culledNow(),
      await offscreen(),
      "after a wheel pan settles, exactly the boards outside the view are culled",
    );
    // Zoomed out to everything, nothing is culled; the setting turns culling off.
    await page.evaluate(() => window.design.zoomToFit());
    await page.waitForTimeout(300);
    assert.deepEqual([await culledNow(), await offscreen()], [[], []], "fit shows every board");
    await page.evaluate(() => window.design.setCamera(100, 100, 1));
    await frame();
    assert.ok((await culledNow()).length >= 4);
    await page.evaluate(() => {
      localStorage.setItem("verynize.canvas-cull", "off");
      window.render();
    });
    assert.deepEqual(await culledNow(), [], "verynize.canvas-cull = off draws every board");
    await page.evaluate(() => {
      localStorage.removeItem("verynize.canvas-cull");
      window.render();
    });
    assert.deepEqual(
      await culledNow(),
      await offscreen(),
      "and culling resumes when it is removed",
    );
    // Edits to a culled board are drawn (and measured) while it stays culled.
    await page.evaluate(() =>
      window.design.updateNodes(["A7t"], { text: "A much longer board text that hugs wider" }),
    );
    const longer = await page.evaluate(() => [
      window.design.getDocument().pages[0].nodes.find((n) => n.id === "A7t").w,
      document.querySelector("#canvas [data-id=A7t]").offsetWidth,
    ]);
    assert.ok(
      Math.abs(longer[0] - longer[1]) <= 1 && longer[0] > inside.hug,
      "a hugging layer edited inside a culled board stores its new size",
    );
    await matchesFullRender("edit inside a culled board");

    // ---- 5. Cheaper commits: subscribers, image preflight, idle persistence ----
    const notified = await page.evaluate(() => {
      let bare = 0,
        seen = null;
      const offBare = window.design.subscribe(() => {
        bare++;
      });
      const offDoc = window.design.subscribe((doc) => {
        seen = doc;
        doc.name = "mutated by a subscriber";
      });
      window.design.updateNodes(["A0r"], { color: "#445566" });
      offBare();
      offDoc();
      return { bare, gotCopy: !!seen?.pages, name: window.design.getDocument().name };
    });
    assert.deepEqual(
      [notified.bare, notified.gotCopy],
      [1, true],
      "subscribers are notified; one with a parameter receives the document",
    );
    assert.notEqual(notified.name, "mutated by a subscriber", "a subscriber copy stays private");
    // Edits that add image bytes are still checked against the storage limits (and roll back); others are not.
    const refused = await page.evaluate(() => {
      const big =
        "data:image/svg+xml;base64," +
        btoa(
          `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><!--${"x".repeat(16_000_000)}--><rect width="40" height="40"/></svg>`,
        ); // over the 20 MiB asset limit
      try {
        window.design.updateNodes(["I"], { src: big });
        return { code: null };
      } catch (e) {
        return {
          code: e.code || e.message,
          rolledBack:
            window.design.getDocument().pages[0].nodes.find((n) => n.id === "I").src.length < 1e6,
        };
      }
    });
    assert.deepEqual(
      refused,
      { code: "storage_limit", rolledBack: true },
      "an edit that adds an over-limit image is refused and rolled back",
    );
    await page.keyboard.press("Escape").catch(() => {});
    // The document is written once the editor is idle, without another render, and an edit right before a reload
    // is flushed when the page hides.
    await page.evaluate(() => window.design.updateNodes(["A0r"], { name: "saved when idle" }));
    await page.waitForFunction(
      () => (localStorage.getItem("verynize-v2") || "").includes("saved when idle"),
      null,
      { timeout: 2000 },
    );
    const reloaded = page.waitForEvent("load");
    await page.evaluate(() => {
      window.design.updateNodes(["A0r"], { name: "flushed on reload" });
      location.reload();
    });
    await reloaded;
    await waitForUiReady(page);
    assert.equal((await node("A0r"))?.name, "flushed on reload", "the last edit survives a reload");

    assert.deepEqual(errors, []);
    console.log(
      "PASS canvas incremental render: live drag without renders (one render + one undo step at release, rotated layers, nesting, Alt copy); keyed render (only edited elements written, identity kept, equal to a full rebuild for edits, selection, layout cascades, shaders, variables, order, re-parent, delete, type changes, undo/redo, foreign writes, text editing, cloud operations, MCP live edits); cheaper commits (private subscriber copies, image limits on edits, idle save flushed on reload); offscreen boards culled with exact geometry, export and hit testing, revealed by camera jumps and wheel pans, off switch",
    );
  } finally {
    await client?.close().catch(() => {});
    await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
