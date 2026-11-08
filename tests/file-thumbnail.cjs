// "Set as file thumbnail" (Wonder P4, design/wonder/canvas-audit/wonder/notes-2026-10-31-b.md): the last row of the
// layer menu stores the layer as `document.thumbnailNodeId`, toasts "Thumbnail updated", keeps its label, survives a
// reload, and the Files card draws that layer alone, covering the thumbnail box. When the layer is deleted the card
// falls back to the active page.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "file-thumbnail-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const ready = async () => {
      await page.waitForSelector("#canvas-toolbar");
      await page.waitForFunction(() => window.fileLibrary?.currentId);
    };
    await ready();
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.name = "Sunbird";
      d.pages = [
        {
          id: "p1",
          name: "Page 1",
          nodes: [
            {
              id: "hero",
              name: "Hero",
              type: "frame",
              x: 0,
              y: 0,
              w: 600,
              h: 300,
              color: "#1e3a8a",
              layout: "free",
              parentId: null,
            },
            {
              id: "card",
              name: "Frame",
              type: "frame",
              x: 700,
              y: 0,
              w: 420,
              h: 391.18,
              color: "#ffffff",
              layout: "free",
              parentId: null,
            },
            {
              id: "label",
              name: "Canvas au",
              type: "text",
              x: 59,
              y: 160,
              w: 60,
              h: 15,
              text: "Canvas au",
              fontSize: 12,
              color: "#000000",
              parentId: "card",
            },
          ],
        },
        { id: "p2", name: "Page 2", nodes: [] },
      ];
      d.activePage = "p1";
      window.design.setDocument(d);
      window.design.setTool("move");
      window.design.setCamera(40, 40, 0.8);
    });
    await page.waitForSelector('#canvas [data-id="card"]');
    const fileId = await page.evaluate(() => window.fileLibrary.currentId);
    const items = () =>
      page
        .locator("#canvas-menu")
        .evaluate((menu) =>
          [...menu.querySelectorAll("[role=menuitem], [role=separator]")].map((el) =>
            el.getAttribute("role") === "separator"
              ? "|"
              : el.querySelector("span").textContent.trim(),
          ),
        );
    const openMenu = async (id) => {
      const r = await page.locator(`#canvas [data-id="${id}"]`).boundingBox();
      await page.mouse.click(r.x + r.width * 0.9, r.y + r.height * 0.9, { button: "right" });
      await page.waitForSelector("#canvas-menu");
    };

    // The row is last, after a separator, in the frame menu.
    await openMenu("card");
    assert.deepEqual(
      (await items()).slice(-3),
      ["Layout", "|", "Set as file thumbnail"],
      "Set as file thumbnail is the last row",
    );
    await page.locator('#canvas-menu [data-command="menu.setThumbnail"]').click();
    const toast = page.locator("[data-sonner-toast]", { hasText: "Thumbnail updated" });
    await toast.waitFor({ timeout: 5000 });
    assert.equal(
      await page.evaluate(() => window.design.getDocument().thumbnailNodeId),
      "card",
      "the frame is stored as the thumbnail",
    );
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      ["card"],
      "the selection stays",
    );
    // The label stays the same afterwards (no check mark, no remove variant).
    await openMenu("card");
    assert.equal((await items()).at(-1), "Set as file thumbnail", "the label is unchanged");
    await page.keyboard.press("Escape");
    // Text layers and the layer rows list it too (Wonder CM3 / CM7).
    await page.evaluate(() => window.design.setSelection(["label"]));
    await page.locator('#bd-layer-tree .layer-row[data-id="hero"]').click({ button: "right" });
    assert.equal(
      await page
        .locator('[data-bd-context-menu][data-target=row] [data-command="menu.setThumbnail"]')
        .count(),
      1,
      "layer row menu",
    );
    await page.keyboard.press("Escape");

    // Invalid values are rejected by validate().
    const rejected = await page.evaluate(() => {
      const d = window.design.getDocument();
      d.thumbnailNodeId = 5;
      try {
        window.design.loadDocument(d);
        return false;
      } catch (e) {
        return /file thumbnail/.test(e.message);
      }
    });
    assert.ok(rejected, "validate() rejects a non-string thumbnail id");

    // Persisted across a reload.
    await page.waitForTimeout(400);
    await page.reload();
    await waitForUiReady(page);
    await ready();
    assert.equal(
      await page.evaluate(() => window.design.getDocument().thumbnailNodeId),
      "card",
      "thumbnail survives reload",
    );

    // The Files card draws the frame alone and covers the thumbnail box.
    const cardThumb = () =>
      page.locator(`.file-card[data-file-id="${fileId}"] .file-open > div`).first();
    const openFiles = async () => {
      await page.locator("#files-home").click();
      await page.waitForSelector(`.file-card[data-file-id="${fileId}"]`);
      await page.waitForTimeout(200);
    };
    await openFiles();
    const shot = await cardThumb().evaluate((el) => {
      const box = el.querySelector("[data-thumbnail-node]");
      const art = box?.firstElementChild,
        drawn = art?.firstElementChild;
      const b = el.getBoundingClientRect(),
        d = drawn?.getBoundingClientRect();
      return {
        node: box?.dataset.thumbnailNode,
        children: art?.childElementCount,
        text: drawn?.textContent,
        box: [b.left, b.top, b.right, b.bottom],
        drawn: d && [d.left, d.top, d.right, d.bottom],
        bg: drawn && getComputedStyle(drawn).backgroundColor,
      };
    });
    assert.equal(shot.node, "card", "the card uses the chosen frame");
    assert.equal(shot.children, 1, "only the chosen frame is drawn");
    assert.equal(shot.text, "Canvas au");
    assert.equal(shot.bg, "rgb(255, 255, 255)");
    const [bl, bt, br, bb] = shot.box,
      [dl, dt, dr, db] = shot.drawn;
    assert.ok(
      dl <= bl + 0.5 && dt <= bt + 0.5 && dr >= br - 0.5 && db >= bb - 0.5,
      "the frame covers the thumbnail box: " + JSON.stringify(shot),
    );
    assert.ok(
      Math.abs((dl + dr) / 2 - (bl + br) / 2) < 1 && Math.abs((dt + db) / 2 - (bt + bb) / 2) < 1,
      "and is centred",
    );

    // Deleting the frame falls back to the active page.
    await page.locator(`.file-card[data-file-id="${fileId}"] .file-open`).click();
    await ready();
    await page.waitForSelector('#canvas [data-id="card"]');
    await page.evaluate(() => window.design.setSelection(["card"]));
    await page.locator("#canvas-wrap").hover();
    await page.keyboard.press("Backspace");
    await page.waitForFunction(
      () => !window.design.getDocument().pages[0].nodes.some((n) => n.id === "card"),
    );
    await openFiles();
    const fallback = await cardThumb().evaluate((el) => {
      const box = el.querySelector(".absolute.inset-0");
      return {
        node: box?.dataset.thumbnailNode ?? null,
        children: box?.firstElementChild?.childElementCount ?? 0,
      };
    });
    assert.deepEqual(
      fallback,
      { node: null, children: 1 },
      "the card falls back to the active page (hero only)",
    );

    assert.deepEqual(errors, []);
    console.log(
      "PASS file thumbnail: menu row last, toast, unchanged label, validation, reload, Files card cover, fallback after delete",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
