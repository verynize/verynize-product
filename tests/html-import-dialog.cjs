// Import HTML dialog in the real app: a chosen .html file with a <link> stylesheet and @import
// (resolved relative to the file by desktop/html-import.cjs -> integrations/codec-html.mjs), the
// viewport selector (media queries), :root variables becoming colour/typed variables, and pasted HTML.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "bd-html-import-"));
  const site = await fs.mkdtemp(path.join(os.tmpdir(), "bd-html-site-"));
  await fs.mkdir(path.join(site, "css"));
  await fs.writeFile(
    path.join(site, "css", "tokens.css"),
    ":root { --brand: #be123c; --pad: 18px }",
  );
  await fs.writeFile(
    path.join(site, "css", "site.css"),
    '@import "tokens.css"; .card { padding: var(--pad); background: var(--brand); color: #fff; border-radius: 16px; width: 320px } @media (max-width: 800px) { .card { border-radius: 4px } }',
  );
  await fs.writeFile(
    path.join(site, "page.html"),
    '<!doctype html><html><head><title>Landing</title><link rel="stylesheet" href="css/site.css"></head><body style="margin:0"><div class="card"><h2>Hello</h2></div></body></html>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    timeout: 20000,
    env,
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow({ timeout: 15000 });
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      },
      path.join(site, "page.html"),
    );
    const open = async () => {
      await page.locator(".app-menu-trigger:visible").first().click();
      await page.locator("#import").click();
      await page.waitForSelector("#import-viewport", { state: "visible" });
    };
    // The viewport picker is a shadcn Select (a listbox, not a native <select>).
    const chooseViewport = async (label) => {
      await page.locator("#import-viewport").click();
      await page.getByRole("option", { name: label, exact: true }).click();
    };
    const closed = () =>
      page.waitForFunction(() => !document.getElementById("modal"), null, { timeout: 15000 });
    const before = await page.evaluate(() => window.design.getDocument().pages[0].nodes.length);

    await open();
    assert.equal(await page.locator("#html-import-options").isVisible(), true);
    await chooseViewport("Laptop · 1280");
    await page.locator("#import-file").click();
    await closed();
    let doc = await page.evaluate(() => window.design.getDocument());
    let card = doc.pages[0].nodes.find((n) => n.name === "div.card");
    assert.ok(card, "the card was imported");
    assert.deepEqual([card.padding, card.radius, card.w, card.token], [18, 16, 320, "brand"]);
    assert.equal(doc.tokens.brand, "#be123c");
    assert.deepEqual(doc.variables.pad, { type: "dimension", value: 18 });
    assert.deepEqual(card.bindings, { padding: "pad" });
    const root = doc.pages[0].nodes.find((n) => n.name === "Landing" && !n.parentId);
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      [root.id],
      "the new artboard is selected",
    );
    assert.equal(
      await page.locator(`#canvas [data-id="${card.id}"]`).count(),
      1,
      "rendered on the canvas",
    );
    assert.equal(
      await page
        .locator(`#canvas [data-id="${card.id}"]`)
        .evaluate((e) => getComputedStyle(e).borderTopLeftRadius),
      "16px",
    );

    // Phone viewport: the stylesheet's media query applies.
    await open();
    await chooseViewport("Phone · 390");
    await page.locator("#import-file").click();
    await closed();
    doc = await page.evaluate(() => window.design.getDocument());
    const cards = doc.pages[0].nodes.filter((n) => n.name === "div.card");
    assert.equal(cards.length, 2);
    assert.equal(cards[1].radius, 4);

    // Pasted HTML with a <style> block and :root token; one undo removes the import.
    await open();
    await page
      .locator("#source")
      .fill(
        '<style>:root{--ink:#0e7490} .note{color:var(--ink);font-size:20px}</style><p class="note">Pasted note</p>',
      );
    await page.locator("#apply").click();
    await closed();
    doc = await page.evaluate(() => window.design.getDocument());
    const note = doc.pages[0].nodes.find((n) => n.text === "Pasted note");
    assert.deepEqual([note.token, note.fontSize, doc.tokens.ink], ["ink", 20, "#0e7490"]);
    assert.ok((await page.locator("#import-notice").count()) <= 1);
    await page.evaluate(() => document.getElementById("undo").click());
    assert.equal(
      await page.evaluate(() =>
        window.design.getDocument().pages[0].nodes.some((n) => n.text === "Pasted note"),
      ),
      false,
    );
    assert.ok(
      (await page.evaluate(() => window.design.getDocument().pages[0].nodes.length)) > before,
    );
    console.log(
      "PASS Import HTML dialog: file + linked/@import stylesheets, viewport media queries, :root variables and bindings, pasted <style>, selection, undo",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
    await fs.rm(site, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
