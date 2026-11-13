// Two Electron clients in one room: an image inserted by one client is uploaded to the room's R2
// asset store and the other client receives only its URL (never the data URI). The image renders
// in both editors and a raster export inlines it for the offline renderer. Creating a room from a
// file with embedded binaries (image layer, image fill, font) uploads them first, with progress:
// no request carries the bytes inside the document.
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-assets-ui-"));
const options = await cloudOptions(path.join(dir, "state"));
const mf = new Miniflare(options);
const apps = [];
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  await Promise.all(
    [a, b].map((page) => page.waitForFunction(() => !!window.design && !!window.cloudAssets)),
  );
  // Every frame client A sends over the room socket.
  const sent = [];
  a.on("websocket", (socket) =>
    socket.on("framesent", (frame) => sent.push(String(frame.payload))),
  );

  await openSharedDesign(a);
  await a.locator("#cloud-server").fill(server);
  await a.locator("#cloud-create").click();
  await a.waitForFunction(() => document.getElementById("cloud-invite").value.includes("token="));
  const invite = await a.locator("#cloud-invite").inputValue();
  const room = new URLSearchParams(new URL(invite).hash.slice(1));
  b.on("dialog", async (dialog) => dialog.accept(dialog.type() === "prompt" ? invite : undefined));
  await openSharedDesign(b);
  await b.locator("#cloud-invite").fill(invite);
  await b.locator("#cloud-connect").click();
  await b.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  await a.locator("#cloud-close").click();
  await b.locator("#cloud-close").click();

  // Insert a real (canvas-encoded) red PNG as an embedded image in client A.
  const inserted = await a.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 64, 64);
    const src = canvas.toDataURL("image/png");
    const id = window.design.addNode("image", { src, name: "Red", x: 40, y: 40, w: 64, h: 64 });
    return { id, src };
  });
  assert.ok(inserted.id);
  const srcOf = (page, id) =>
    page.evaluate(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src || "",
      id,
    );
  // A swaps the data URI for the room asset URL; B receives that URL.
  await a.waitForFunction(
    (id) =>
      /\/assets\//.test(
        window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src || "",
      ),
    inserted.id,
    { timeout: 20000 },
  );
  const url = await srcOf(a, inserted.id);
  assert.match(
    url,
    new RegExp(
      `^${server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/rooms/${room.get("room")}/assets/[0-9a-f-]{36}\\?sig=[0-9a-f]{64}$`,
    ),
  );
  await b.waitForFunction(
    ([id, url]) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src === url,
    [inserted.id, url],
    { timeout: 20000 },
  );
  // The image bytes never travelled through the room: no socket frame and no server document
  // holds the data URI.
  assert.equal(
    sent.some((frame) => frame.includes("data:image/png")),
    false,
  );
  assert.equal(
    sent.some((frame) => frame.includes(url.split("?")[0])),
    true,
  );
  const shared = await (
    await fetch(`${server}/api/rooms/${room.get("room")}`, {
      headers: { authorization: `Bearer ${room.get("token")}` },
    })
  ).json();
  assert.equal(JSON.stringify(shared.document).includes("data:image"), false);
  assert.equal(shared.document.pages[0].nodes.find((n) => n.id === inserted.id).src, url);

  // Both editors render the remote image (decoded, not broken).
  for (const page of [a, b])
    await page.waitForFunction(
      (id) => {
        const img = document.querySelector(`[data-id="${CSS.escape(id)}"] img`);
        return img && img.complete && img.naturalWidth === 64;
      },
      inserted.id,
      { timeout: 20000 },
    );

  // Inserting the same image again reuses the uploaded asset (no second upload).
  const again = await b.evaluate(
    (src) =>
      window.design.addNode("image", { src, name: "Red again", x: 140, y: 40, w: 64, h: 64 }),
    inserted.src,
  );
  await a.waitForFunction(
    ([id, url]) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src === url,
    [again, url],
    { timeout: 20000 },
  );

  // Raster export inlines the room image for the offline renderer: the exported PNG is red.
  await b.evaluate((id) => window.design.setSelection([id]), inserted.id);
  const pixel = await b.evaluate(async () => {
    const result = await window.design.exportArtwork({
      format: "PNG",
      scale: 1,
      selectionOnly: true,
    });
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = result.dataURL;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return [
      ...ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data,
    ];
  });
  assert.ok(
    pixel[0] > 200 && pixel[1] < 50 && pixel[2] < 50 && pixel[3] > 200,
    `pixel ${pixel.join(",")}`,
  );
  assert.equal((await a.evaluate(() => window.cloudAssets.status())).failed, 0);

  // ---- Creating a room from a local file with embedded binaries uploads them first. ----
  await openSharedDesign(a);
  await a.locator("#cloud-leave").click();
  await a.locator("#cloud-close").click();
  const local = await a.evaluate(() => {
    // Random pixels do not compress: about 100 KB of PNG, well above the 8 KB inline limit.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 160;
    const ctx = canvas.getContext("2d");
    const pixels = ctx.createImageData(160, 160);
    for (let i = 0; i < pixels.data.length; i++)
      pixels.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
    ctx.putImageData(pixels, 0, 0);
    const photo = canvas.toDataURL("image/png");
    const green = canvas.toDataURL("image/jpeg", 1);
    const font = `data:font/woff2;base64,${btoa("wOF2" + "x".repeat(12000))}`;
    const doc = window.design.getDocument();
    const page = doc.pages.find((p) => p.id === doc.activePage);
    page.nodes = [
      { id: "photo", type: "image", name: "Photo", x: 0, y: 0, w: 160, h: 160, src: photo },
      {
        id: "card",
        type: "rectangle",
        name: "Card",
        x: 200,
        y: 0,
        w: 160,
        h: 160,
        fills: [{ type: "image", src: green, fit: "cover", opacity: 50 }],
      },
    ];
    doc.fontFaces = [{ family: "Brand Sans", weight: "400", style: "normal", src: font }];
    window.design.loadDocument(doc);
    return { photo, green, font, bytes: photo.length + green.length + font.length };
  });
  assert.ok(local.photo.length > 50000 && local.green.length > 8192, JSON.stringify(local.bytes));
  const posted = [];
  a.on("request", (request) => {
    if (request.method() !== "GET" && request.url().startsWith(server))
      posted.push({ url: request.url(), body: request.postData() || "" });
  });
  const progress = [];
  await a.exposeFunction("recordProgress", (text) => progress.push(text));
  await a.evaluate(() => {
    const status = document.getElementById("cloud-status");
    new MutationObserver(() => window.recordProgress(status.textContent)).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await openSharedDesign(a);
  await a.locator("#cloud-create").click();
  await a.waitForFunction(
    () => document.getElementById("cloud-status").textContent.includes("Connected"),
    null,
    { timeout: 30000 },
  );
  // The owner's invite field holds a token-free link until the role-limited invite token arrives.
  await a.waitForFunction((first) => {
    const hash = new URLSearchParams(
      new URL(document.getElementById("cloud-invite").value || "about:blank").hash.slice(1),
    );
    return hash.get("token") && hash.get("room") && hash.get("room") !== first;
  }, room.get("room"));
  const created = new URLSearchParams(
    new URL(await a.locator("#cloud-invite").inputValue()).hash.slice(1),
  );
  assert.notEqual(created.get("room"), room.get("room"));
  assert.ok(
    progress.some((text) => /Uploading 3 files to the new room/.test(text)),
    progress.join(" | "),
  );
  // No request put the bytes into a room document: they went to the asset upload URLs only.
  const documentWrites = posted.filter(
    (request) => !/\/assets(\/|$)/.test(new URL(request.url).pathname),
  );
  assert.ok(documentWrites.length >= 2, JSON.stringify(documentWrites.map((r) => r.url)));
  // (a stand-in 1×1 image may travel while the room is created; the real bytes never do).
  for (const request of documentWrites)
    for (const value of [local.photo, local.green, local.font])
      assert.equal(request.body.includes(value.slice(-200)), false, request.url);
  const uploads = posted.filter(
    (request) => request.url.includes("/assets/") && request.url.includes("signature="),
  );
  assert.equal(uploads.length, 3);
  const assetPattern = new RegExp(
    `/api/rooms/${created.get("room")}/assets/[0-9a-f-]{36}\\?sig=[0-9a-f]{64}$`,
  );
  // The room document may still be settling right after "Connected" (the asset swap lands as a
  // server batch): poll until it holds the photo, and report the last response otherwise.
  let roomDoc, last;
  for (let i = 0; i < 100 && !roomDoc; i++) {
    const res = await fetch(`${server}/api/rooms/${created.get("room")}`, {
      headers: { authorization: `Bearer ${created.get("token")}` },
    });
    last = { status: res.status, body: await res.text() };
    let doc = null;
    try {
      doc = res.ok ? JSON.parse(last.body).document : null;
    } catch {}
    if (doc?.pages?.some((p) => p.nodes.some((n) => n.id === "photo" && assetPattern.test(n.src))))
      roomDoc = doc;
    else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    roomDoc,
    `room document with the uploaded photo: ${last.status} ${last.body.slice(0, 500)}`,
  );
  const [photoNode, cardNode] = roomDoc.pages.find((p) =>
    p.nodes.some((n) => n.id === "photo"),
  ).nodes;
  assert.match(photoNode.src, assetPattern);
  assert.match(cardNode.fills[0].src, assetPattern);
  assert.equal(cardNode.fills[0].opacity, 50);
  assert.match(roomDoc.fontFaces[0].src, assetPattern);
  // The asset holds the original bytes.
  const served = Buffer.from(await (await fetch(photoNode.src)).arrayBuffer());
  assert.ok(served.equals(Buffer.from(local.photo.split(",")[1], "base64")));
  // The editor ends on asset URLs too (embedded copies are swapped after connecting), and the
  // half-transparent image fill renders from its asset URL: green at 50 % over the canvas.
  await a.waitForFunction(
    () => {
      const nodes = window.design.getDocument().pages.flatMap((p) => p.nodes);
      return ["photo", "card"].every((id) => {
        const node = nodes.find((n) => n.id === id);
        return /\/assets\//.test(node?.src || node?.fills?.[0]?.src || "");
      });
    },
    null,
    { timeout: 20000 },
  );
  const fill = await a.evaluate(() =>
    [...document.querySelectorAll('[data-id="card"]')]
      .map((el) => getComputedStyle(el).backgroundImage)
      .join(" "),
  );
  assert.match(fill, /cross-fade/);
  assert.equal((await a.evaluate(() => window.cloudAssets.status())).failed, 0);

  console.log(
    "PASS desktop room assets: inserted image uploaded to R2, collaborator receives only the URL, both editors render it, dedupe on reinsert, raster export inlines it, room creation uploads image, fill and font first with progress",
  );
} finally {
  await Promise.all(apps.map((app) => app.close().catch(() => {})));
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
