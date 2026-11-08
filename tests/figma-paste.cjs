// Electron: Figma layers on the system clipboard paste onto the canvas as editable layers (one undo step);
// a .fig file dropped on the canvas opens as a new document with its embedded image; a .pen drop is refused
// with an explanation; the Figma dialog saves the OAuth client ID (Settings › Connections › Figma).
const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const { mod } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const { clipboardHtml, figFile } = await import("./fixtures/figma-scene-fixture.mjs");
  const profile = await fs.mkdtemp(os.tmpdir() + "/bd-figma-"),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    timeout: 20000,
    env,
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const p = await app.firstWindow({ timeout: 15000 });
    await p.waitForSelector("#canvas .layer");
    const footer = () =>
      p.evaluate(
        () =>
          (document.querySelector("#workspace footer") || document.querySelector("footer"))
            ?.textContent || "",
      );
    const before = await p.evaluate(() => {
      const d = window.design.getDocument();
      return d.pages.find((x) => x.id === d.activePage).nodes.length;
    });
    // Paste from the real system clipboard (Figma only writes text/html).
    await app.evaluate(
      async ({ clipboard, ClipboardItem }, html) => {
        clipboard.clear();
        await clipboard.write([new ClipboardItem({ "text/html": html })]);
      },
      clipboardHtml({ compression: "zstd" }),
    );
    await p.evaluate(() => window.design.setSelection([]));
    await p.locator("#workspace").click({ position: { x: 40, y: 300 } });
    await p.keyboard.press(mod("V"));
    await p.waitForFunction(
      (n) => {
        const d = window.design.getDocument();
        return d.pages.find((x) => x.id === d.activePage).nodes.length > n;
      },
      before,
      { timeout: 10000 },
    );
    const pasted = await p.evaluate(() => {
      const d = window.design.getDocument();
      return d.pages
        .find((x) => x.id === d.activePage)
        .nodes.filter((n) =>
          ["Card", "Title", "Triangle", "Row", "Label", "Glass"].includes(n.name),
        )
        .map((n) => ({
          name: n.name,
          type: n.type,
          id: n.id,
          parent: n.parentId,
          text: n.text,
          layout: n.layout,
        }));
    });
    assert.deepEqual(
      pasted.map((n) => n.name),
      ["Card", "Title", "Triangle", "Row", "Label", "Glass"],
    );
    const card = pasted[0];
    assert.equal(card.parent, null);
    assert.equal(pasted.find((n) => n.name === "Row").layout, "flex");
    assert.equal(pasted.find((n) => n.name === "Label").text, "Checkout");
    // Pasted layers are selected and rendered: the vector is an SVG image, the text renders its characters.
    assert.deepEqual(await p.evaluate(() => window.design.getSelection()), [card.id]);
    const tri = pasted.find((n) => n.name === "Triangle");
    assert.match(
      await p.locator(`#canvas [data-id="${tri.id}"] img`).getAttribute("src"),
      /^data:image\/svg\+xml;base64,/,
    );
    assert.match(
      await p.locator(`#canvas [data-id="${pasted[1].id}"]`).innerText(),
      /hello figma/i,
    );
    const glassFilter = await p
      .locator(`#canvas [data-id="${pasted.find((n) => n.name === "Glass").id}"]`)
      .evaluate((e) => getComputedStyle(e).backdropFilter);
    assert.equal(glassFilter, "blur(10px)");
    assert.match(await footer(), /Pasted 15 Figma layers/);
    // One undo removes the whole paste.
    await p.evaluate(() => window.design.setSelection([]));
    await p.keyboard.press(mod("Z"));
    await p.waitForFunction((n) => {
      const d = window.design.getDocument();
      return d.pages.find((x) => x.id === d.activePage).nodes.length === n;
    }, before);
    // Corrupt Figma clipboard data reports an error and pastes nothing.
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      clipboard.clear();
      await clipboard.write([
        new ClipboardItem({ "text/html": "<span>(figma)AAAA(/figma)</span>" }),
      ]);
    });
    await p.locator("#workspace").click({ position: { x: 40, y: 300 } });
    await p.keyboard.press(mod("V"));
    await p.waitForFunction(() => window.figmaPaste.lastError !== "");
    assert.match(
      await p.evaluate(() => window.figmaPaste.lastError),
      /Unable to read Figma clipboard data/,
    );

    // Drop a .fig file on the canvas: opens as a new document with the embedded bitmap.
    const drop = (name, base64) =>
      p.evaluate(
        ({ name, base64 }) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], name));
          const target = document.querySelector("#canvas") || document.querySelector("#workspace");
          const over = new DragEvent("dragover", {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          });
          target.dispatchEvent(over);
          target.dispatchEvent(
            new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
          );
          return over.defaultPrevented;
        },
        { name, base64 },
      );
    const { bytes, png } = figFile();
    assert.equal(await drop("Fixture design.fig", Buffer.from(bytes).toString("base64")), true);
    await p.waitForFunction(() => window.design.getDocument().name === "Fixture design", null, {
      timeout: 10000,
    });
    const photo = await p.evaluate(() => {
      const d = window.design.getDocument();
      return d.pages[0].nodes.find((n) => n.name === "Photo");
    });
    assert.equal(photo.type, "image");
    assert.equal(photo.src, "data:image/png;base64," + Buffer.from(png).toString("base64"));
    await drop("Secret.pen", Buffer.from("encrypted").toString("base64"));
    await p.waitForFunction(() => /encrypted by their vendor/.test(window.figmaPaste.lastError));
    assert.equal(await p.evaluate(() => window.design.getDocument().name), "Fixture design");

    // Dialog: account settings persist the client ID and port (no secret, nothing sealed yet).
    await p.evaluate(() => document.getElementById("figma-import").click());
    await p.locator("#figma-dialog").waitFor();
    await p.waitForFunction(
      () => document.getElementById("figma-account-status").textContent !== "",
    );
    assert.equal(
      await p.locator("#figma-account-status").textContent(),
      "Add a client ID to connect.",
    );
    await p.locator("#figma-client-id").fill("my-figma-app");
    await p.locator("#figma-port").fill("48123");
    await p.locator("#figma-oauth-save").click();
    await p.waitForFunction(
      () => document.getElementById("figma-account-status").textContent === "Not connected.",
    );
    assert.equal(
      await p.locator("#figma-redirect").textContent(),
      "http://127.0.0.1:48123/figma/callback",
    );
    assert.equal(await p.locator("#figma-disconnect").isHidden(), true);
    const saved = JSON.parse(await fs.readFile(path.join(profile, "figma-oauth.json"), "utf8"));
    assert.deepEqual(saved, { clientId: "my-figma-app", port: 48123 });
    await p.locator("#figma-close").click();
    console.log("figma paste/drop/dialog: ok");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
