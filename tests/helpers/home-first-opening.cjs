const assert = require("node:assert/strict");

// Real library/canvas work, observed at the first paint after the user's click.
// No timers or replacement library/lifecycle methods are used to fake a slow load.
exports.checkHomeOpening = async (page, { detached = false } = {}) => {
  const id = await page.evaluate(async (detached) => {
    await window.verynizeEditorBoot?.();
    const doc = window.design.getDocument();
    doc.name = "Opening fixture";
    const options = detached
      ? { cloud: { server: location.origin, roomId: crypto.randomUUID(), detached: true } }
      : {};
    const id = await window.fileLibrary.createFromDocument(doc, options);
    const other = structuredClone(doc);
    other.name = "Other fixture";
    await window.fileLibrary.createFromDocument(
      other,
      detached ? { cloud: { ...options.cloud, roomId: crypto.randomUUID() } } : {},
    );
    window.fileLibrary.showHome();
    window.__openingPaint = null;
    window.addEventListener("switch-loading-change", function observe(event) {
      if (event.detail.phase !== "begin" || event.detail.to.fileKey !== id) return;
      window.removeEventListener("switch-loading-change", observe);
      requestAnimationFrame(() => {
        const logo = document.getElementById("switch-loading-logo");
        const rect = logo.getBoundingClientRect();
        const mark = logo.querySelector("svg").getBoundingClientRect();
        window.__openingPaint = {
          home: document.body.classList.contains("files-view"),
          path: location.pathname,
          visible: getComputedStyle(logo).display !== "none",
          centered:
            Math.abs(mark.x + mark.width / 2 - rect.x - rect.width / 2) < 2 &&
            Math.abs(mark.y + mark.height / 2 - rect.y - rect.height / 2) < 2,
          document: window.design.getDocument().name,
        };
      });
    });
    return id;
  }, detached);
  await page.locator(`#library-files [data-file-id="${id}"] .file-open`).click();
  await page.waitForFunction(() => window.__openingPaint !== null);
  const paint = await page.evaluate(() => window.__openingPaint);
  assert.equal(paint.home, false, "Home leaves before loading the document");
  assert.equal(paint.visible, true, "the existing logo cover is visible on the first paint");
  assert.equal(paint.centered, true, "the Verynize mark is centered");
  assert.equal(paint.document, "Other fixture", "the cover paints before document replacement");
  assert.equal(paint.path, `/editor/${id}`);
  await page.waitForFunction(() => window.design.getDocument().name === "Opening fixture");
  await page.waitForFunction(() => !document.body.dataset.switchLoading);
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), id);
  // A Home navigation made before the load commits cancels it instead of reopening the editor.
  await page.evaluate(() => {
    window.fileLibrary.showHome();
    const other = window.fileLibrary.summaries().find((file) => file.name === "Other fixture");
    void window.fileLibrary.open(other.id).catch((error) => {
      if (error.message !== "Document switch canceled") throw error;
    });
    window.fileLibrary.showHome();
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => document.body.classList.contains("files-view")), true);
  assert.equal(await page.evaluate(() => window.design.getDocument().name), "Opening fixture");
  await page.evaluate((id) => window.fileLibrary.open(id), id);
  return id;
};
