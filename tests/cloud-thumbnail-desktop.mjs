// Real Electron -> dedicated thumbnail upload -> R2 -> home cover image, including refresh and restore.
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { waitForAsync } from "./helpers/wait-for-async.cjs";
import { waitForUiReady } from "./helpers/ui-ready.cjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-thumbnail-ui-"));
let app;
let mf;
try {
  mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
  const server = (await mf.ready).origin;
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, "client")}`] });
  const page = await app.firstWindow();
  await waitForUiReady(page);
  await page.waitForFunction(() => !!window.fileThumbnails && !!window.fileLibrary?.currentId);
  await page.evaluate(() => {
    const doc = window.design.getDocument();
    doc.pages = [
      {
        id: "cover-page",
        name: "Cover",
        nodes: [
          {
            id: "cover-frame",
            name: "Cover",
            type: "frame",
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
            color: "#ff0000",
            layout: "free",
            parentId: null,
          },
          ...Array.from({ length: 38 }, (_, i) => ({
            id: `detail-${i}`,
            name: `Detail ${i}`,
            type: "rectangle",
            x: 10 + i,
            y: 10,
            w: 1,
            h: 1,
            color: "#ff0000",
            parentId: null,
          })),
          {
            id: "last-root",
            name: "Beyond old limit",
            type: "frame",
            parentId: null,
            x: 1920,
            y: 0,
            w: 1920,
            h: 1080,
            color: "#00ff00",
            layout: "free",
          },
        ],
      },
      { id: "other-page", name: "Working page", nodes: [] },
    ];
    doc.activePage = "other-page";
    delete doc.thumbnailNodeId;
    window.design.setDocument(doc);
  });
  const frames = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => frames.push(String(frame.payload))),
  );
  await openSharedDesign(page);
  await page.locator("#cloud-server").fill(server);
  await page.locator("#cloud-create").click();
  await page.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await page.locator("#cloud-close").click();
  const room = await page.evaluate(() => window.cloudWorkspace.room());
  const fileId = await page.evaluate(() => window.fileLibrary.currentId);
  const metadata = () =>
    page.evaluate(async () => {
      const room = window.cloudWorkspace.room();
      return window.cloudWorkspace.request(`/api/rooms/${room.id}/thumbnail`);
    });
  const uploads = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/thumbnail?"))
      uploads.push(request.url());
  });
  await waitForAsync(page, async () => {
    await window.fileThumbnails.refresh();
    const room = window.cloudWorkspace.room();
    const result = await window.cloudWorkspace.request(`/api/rooms/${room.id}/thumbnail`);
    return result.thumbnail?.nodeId === null && result.thumbnail?.pageId === "cover-page";
  });
  const automatic = (await metadata()).thumbnail;
  assert.match(automatic.url, /\/thumbnail\/image\?/);
  assert.equal(
    await page.evaluate(() => window.design.getDocument().activePage),
    "other-page",
    "automatic cover rendering does not switch the working page",
  );
  const sample = (url) =>
    page.evaluate(async (url) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return {
        width: img.width,
        height: img.height,
        left: [
          ...ctx.getImageData(Math.floor(img.width * 0.2), Math.floor(img.height / 2), 1, 1).data,
        ],
        right: [
          ...ctx.getImageData(Math.floor(img.width * 0.8), Math.floor(img.height / 2), 1, 1).data,
        ],
      };
    }, url);
  const initial = await sample(automatic.url);
  assert.ok(initial.width <= 1920 && initial.height <= 1080);
  assert.deepEqual(initial.left, [255, 0, 0, 255]);
  assert.deepEqual(initial.right, [0, 255, 0, 255], "root 40 is present in the default R2 image");
  await page.evaluate(() => window.design.setThumbnail("cover-frame"));
  await waitForAsync(
    page,
    async () => {
      await window.fileThumbnails.refresh();
      const room = window.cloudWorkspace.room();
      const result = await window.cloudWorkspace.request(`/api/rooms/${room.id}/thumbnail`);
      return result.thumbnail?.nodeId === "cover-frame";
    },
    null,
    { timeout: 30000 },
  );
  const first = (await metadata()).thumbnail;
  assert.match(first.url, /\/thumbnail\/image\?v=[0-9a-f]{64}&sig=[0-9a-f]{64}$/);
  assert.equal(first.contentType, "image/png");
  assert.ok(uploads.length > 0, "cover bytes were uploaded through the thumbnail API");
  const bytes = new Uint8Array(await (await fetch(first.url)).arrayBuffer());
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const colorOf = (url) =>
    page.evaluate(async (url) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }, url);
  const red = await colorOf(first.url);
  assert.ok(red[0] > 220 && red[1] < 30 && red[2] < 30, `cover is red: ${red.join(",")}`);
  await page.locator("#files-home").click();
  const image = page
    .locator(`.file-card[data-file-id="${fileId}"] img[data-file-thumbnail-image]`)
    .first();
  await image.waitFor();
  await image.evaluate((img) => img.decode());
  assert.equal(await image.getAttribute("src"), first.url);
  await page.reload();
  await waitForUiReady(page);
  await image.waitFor();
  await image.evaluate((img) => img.decode());
  assert.equal(
    await image.getAttribute("src"),
    first.url,
    "home reload loads the stored room cover",
  );
  await page.locator(`.file-card[data-file-id="${fileId}"] .file-open`).click();
  await page.waitForSelector("#canvas-toolbar");
  await page.waitForFunction(() => window.cloudWorkspace.isConnected());
  await page.evaluate(() => {
    window.design.setActivePage("cover-page");
    window.design.updateNodes(["cover-frame"], { color: "#0000ff" });
  });
  await waitForAsync(
    page,
    async (sha) => {
      await window.fileThumbnails.refresh();
      const room = window.cloudWorkspace.room();
      const result = await window.cloudWorkspace.request(`/api/rooms/${room.id}/thumbnail`);
      return result.thumbnail && result.thumbnail.sha256 !== sha;
    },
    first.sha256,
    { timeout: 30000 },
  );
  const second = (await metadata()).thumbnail;
  const blue = await colorOf(second.url);
  assert.ok(
    blue[0] < 30 && blue[1] < 30 && blue[2] > 220,
    `updated cover is blue: ${blue.join(",")}`,
  );
  await page.evaluate(() => window.design.setThumbnail(null));
  await waitForAsync(
    page,
    async () => {
      await window.fileThumbnails.refresh();
      const room = window.cloudWorkspace.room();
      const result = await window.cloudWorkspace.request(`/api/rooms/${room.id}/thumbnail`);
      return result.thumbnail?.nodeId === null && result.thumbnail?.pageId === "cover-page";
    },
    null,
    { timeout: 30000 },
  );
  const restored = (await metadata()).thumbnail;
  const fullPage = await sample(restored.url);
  assert.deepEqual(fullPage.left, [0, 0, 255, 255]);
  assert.deepEqual(fullPage.right, [0, 255, 0, 255]);
  assert.equal(await page.evaluate(() => window.design.getDocument().thumbnailNodeId), undefined);
  // Changes on the first page regenerate its automatic cover without selecting a custom frame.
  await page.evaluate(() => window.design.updateNodes(["last-root"], { color: "#ffff00" }));
  await waitForAsync(
    page,
    async (sha) => {
      await window.fileThumbnails.refresh();
      const room = window.cloudWorkspace.room();
      const result = await window.cloudWorkspace.request(`/api/rooms/${room.id}/thumbnail`);
      return result.thumbnail?.nodeId === null && result.thumbnail?.sha256 !== sha;
    },
    restored.sha256,
  );
  assert.deepEqual((await sample((await metadata()).thumbnail.url)).right, [255, 255, 0, 255]);
  assert.ok(room.id);
  assert.equal(
    frames.some((frame) => frame.includes("data:image/png")),
    false,
  );
  console.log(
    "PASS desktop cloud thumbnail: full default first page includes root 40 in R2, custom cover, home reload, edits and restored automatic cover refresh, no binary socket payload",
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error(
      "Thumbnail state:",
      await page
        .evaluate(() => ({
          status: window.fileThumbnails?.status(),
          connected: window.cloudWorkspace?.isConnected(),
          role: window.cloudWorkspace?.role(),
        }))
        .catch(() => null),
    );
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
