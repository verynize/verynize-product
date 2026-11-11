import assert from "node:assert/strict";
import { signedInContext } from "./web-app.mjs";

/** Real account/backend supplied by web-cloudflare; no request interception. */
export async function checkDeferredHome(browser, origin, identity, mode) {
  const context = await signedInContext(browser, origin, identity, {
    viewport: { width: 1440, height: 870 },
  });
  const errors = [];
  const dialogs = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.goto(origin + "/");
    await page.locator("#library-files").waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.legacyHome === "ready");
    const sample = await page.evaluate(() => {
      const resources = performance
        .getEntriesByType("resource")
        .filter((r) => ["script", "link", "css"].includes(r.initiatorType));
      return {
        ms: performance.now(),
        scripts: [...document.scripts].filter(
          (s) => s.src && new URL(s.src).pathname.split("/").length === 2,
        ).length,
        bytes: resources.reduce((sum, r) => sum + r.decodedBodySize, 0),
      };
    });
    console.log(`HOME_BOOT ${mode} ${JSON.stringify(sample)}`);
    const unbooted = () =>
      page.evaluate(() => ({
        design: typeof window.design,
        editor: document.documentElement.dataset.legacyEditor ?? null,
        canvasScript: !!document.querySelector('script[src*="canvas-interactions"]'),
        canvasStyle: !!document.querySelector('link[rel="stylesheet"][href*="canvas.css"]'),
        chat: typeof window.agentWorkspace,
      }));
    const expected = {
      design: "undefined",
      editor: null,
      canvasScript: false,
      canvasStyle: false,
      chat: "undefined",
    };
    assert.deepEqual(await unbooted(), expected);
    // Idle prefetch must not evaluate the canvas or mount the editor islands.
    await page.waitForFunction(
      () => !!document.querySelector('link[rel="prefetch"][href*="canvas-interactions"]'),
    );
    await page.waitForFunction(
      () => document.querySelector('link[data-editor-prefetch="true"]')?.dataset.loaded === "true",
    );
    assert.deepEqual(await unbooted(), expected);
    await page.evaluate(() => {
      window.__homeLibrary = window.fileLibrary;
      window.__homeDocument = document;
    });
    await page.locator("#library-new-file").click();
    await page.locator("#text-prompt-input").fill("Deferred boot regression");
    await page.locator("#text-prompt-ok").click();
    await page.waitForFunction(
      () =>
        location.pathname.startsWith("/editor/") &&
        document.documentElement.dataset.legacyEditor === "ready",
    );
    await page.waitForFunction(
      () => window.design.getDocument().name === "Deferred boot regression",
    );
    await page.evaluate(() => {
      window.__firstDesign = window.design;
      window.design.addNode("rectangle", { name: "Retained rectangle" });
    });
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.fileLibrary.showHome());
      await page
        .locator("#library-files .file-card")
        .filter({ hasText: "Deferred boot regression" })
        .waitFor();
      const card = page
        .locator("#library-files .file-card")
        .filter({ hasText: "Deferred boot regression" });
      await card.locator(".file-open").click();
      await page.waitForFunction(
        () =>
          location.pathname.startsWith("/editor/") &&
          !document.body.classList.contains("files-view"),
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.fileLibrary === window.__homeLibrary &&
            window.design === window.__firstDesign &&
            document === window.__homeDocument,
        ),
        true,
      );
      assert.equal(
        await page.evaluate(() =>
          window.design
            .getDocument()
            .pages.some((p) => p.nodes.some((n) => n.name === "Retained rectangle")),
        ),
        true,
      );
    }
    assert.equal(await page.locator('script[src*="canvas-interactions"]').count(), 1);
    await page.evaluate(async () => {
      await window.cloudWorkspace.flush();
      await window.fileLibrary.flush();
      window.fileLibrary.showHome();
    });
    await page.waitForURL(origin + "/");
    await page.reload();
    const coldCard = page
      .locator("#library-files .file-card")
      .filter({ hasText: "Deferred boot regression" });
    await coldCard.waitFor();
    assert.deepEqual(await unbooted(), expected);
    await coldCard.hover();
    await page.waitForFunction(
      () => !!document.querySelector('link[rel="prefetch"][href*="canvas-interactions"]'),
    );
    assert.deepEqual(await unbooted(), expected);
    await coldCard.locator(".file-open").click();
    await page.waitForFunction(
      () =>
        location.pathname.startsWith("/editor/") &&
        document.documentElement.dataset.legacyEditor === "ready",
    );
    await page.waitForFunction(() =>
      window.design
        .getDocument()
        .pages.some((p) => p.nodes.some((n) => n.name === "Retained rectangle")),
    );
    assert.deepEqual(dialogs, []);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error("Deferred Home browser errors:", errors);
    throw error;
  } finally {
    await context.close();
  }
}
