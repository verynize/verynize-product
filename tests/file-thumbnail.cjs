// "Set as file thumbnail" (Wonder P4, design/wonder/canvas-audit/wonder/notes-2026-10-31-b.md): the last row of the
// layer menu stores the layer as `document.thumbnailNodeId`, toasts "Thumbnail updated", offers restore, survives a
// reload, and the Files card draws that layer alone, covering the thumbnail box. When the layer is deleted the card
// falls back to the first page.
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
    // Restore is explicit and undoable; the set action remains available.
    await openMenu("card");
    assert.equal((await items()).at(-1), "Restore default thumbnail");
    await page.locator('#canvas-menu [data-command="menu.restoreThumbnail"]').click();
    assert.equal(await page.evaluate(() => window.design.getDocument().thumbnailNodeId), undefined);
    await openMenu("card");
    await page.locator('#canvas-menu [data-command="menu.setThumbnail"]').click();
    await openMenu("card");
    assert.ok((await items()).includes("Set as file thumbnail"));
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

    // New thumbnail choices require a frame, while existing document ids remain schema-compatible.
    assert.ok(
      await page.evaluate(() => {
        try {
          window.design.setThumbnail("label");
          return false;
        } catch (error) {
          return /frame/.test(error.message);
        }
      }),
    );
    // A cover can be rendered from another page without changing the page or selection.
    const detached = await page.evaluate(() => {
      window.design.setActivePage("p2");
      const before = JSON.stringify(window.design.getDocument());
      const markup = window.design.thumbnailMarkup("card");
      const unchanged = before === JSON.stringify(window.design.getDocument());
      window.design.setActivePage("p1");
      return { unchanged, width: markup.width, text: markup.html.includes("Canvas au") };
    });
    assert.deepEqual(detached, { unchanged: true, width: 420, text: true });

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
    await page.waitForFunction((id) => {
      const image = document.querySelector(
        `.file-card[data-file-id="${id}"] img[data-file-thumbnail-image]`,
      );
      return image?.complete && image.naturalWidth > 0;
    }, fileId);
    const shot = await cardThumb().evaluate(async (el) => {
      const box = el.querySelector("[data-thumbnail-node]"),
        image = box?.querySelector("img");
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return {
        node: box.dataset.thumbnailNode,
        width: image.naturalWidth,
        height: image.naturalHeight,
        fit: getComputedStyle(image).objectFit,
        pixel: [...context.getImageData(10, 10, 1, 1).data],
        miniature: !!el.querySelector(".thumbnail-artboard"),
      };
    });
    assert.deepEqual(
      shot,
      {
        node: "card",
        width: 420,
        height: 392,
        fit: "cover",
        pixel: [255, 255, 255, 255],
        miniature: false,
      },
      "local cover is a full raster image",
    );

    // Deleting the frame falls back to the first page.
    await page.locator(`.file-card[data-file-id="${fileId}"] .file-open`).click();
    await ready();
    await page.waitForSelector('#canvas [data-id="card"]');
    await page.evaluate(() => window.design.setSelection(["card"]));
    await page.locator("#canvas-wrap").hover();
    await page.keyboard.press("Backspace");
    await page.waitForFunction(
      () => !window.design.getDocument().pages[0].nodes.some((n) => n.id === "card"),
    );
    await page.evaluate(() => window.design.setActivePage("p2"));
    await openFiles();
    await page.waitForFunction((id) => {
      const box = document.querySelector(`.file-card[data-file-id="${id}"] [data-thumbnail-page]`);
      const image = box?.querySelector("img");
      return (
        box?.dataset.thumbnailPage === "p1" &&
        !box.dataset.thumbnailNode &&
        image?.complete &&
        image.naturalWidth > 0
      );
    }, fileId);
    const fallback = await cardThumb().evaluate((el) => {
      const box = el.querySelector("[data-thumbnail-page]"),
        image = box.querySelector("img");
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return {
        node: box.dataset.thumbnailNode || null,
        page: box.dataset.thumbnailPage,
        width: image.naturalWidth,
        height: image.naturalHeight,
        fit: getComputedStyle(image).objectFit,
        pixel: [...context.getImageData(10, 10, 1, 1).data],
        miniature: !!el.querySelector(".thumbnail-artboard"),
      };
    });
    assert.deepEqual(
      fallback,
      {
        node: null,
        page: "p1",
        width: 600,
        height: 300,
        fit: "contain",
        pixel: [30, 58, 138, 255],
        miniature: false,
      },
      "deleted cover renders the complete first page while page 2 is active",
    );

    assert.deepEqual(errors, []);
    console.log(
      "PASS file thumbnail: menu row last, toast, restore, frames-only choices, detached rendering, validation, reload, Files card cover, fallback after delete",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
