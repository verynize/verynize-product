// Web (Node build of web-start) proof of per-tab editor URLs. Run from the repo root after
// `node node_modules/vite-plus/bin/vp build -c vite.node.config.ts`. Real local backend, throwaway account.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, signedInContext } from "../../../../tests/helpers/web-app.mjs";

// Real backend (cloud/worker.js on the Node runtime), as in tests/web-ai-chat.mjs.
process.env.CLOUD_RUNTIME = "node";
const { cloudOptions, passwordUser } = await import("../../../../tests/cloud-harness.mjs");
const { NodeCloud } = await import("../../../../tests/helpers/node-cloud.mjs");
const { createWebServer } = await import("../../../../web-start/node/server.mjs");

const out = path.dirname(fileURLToPath(import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-url-proof-"));
const backend = new NodeCloud(await cloudOptions(path.join(temp, "state")));
const web = await createWebServer({
  dist: path.resolve("dist/web-node"),
  backend: (await backend.ready).origin,
});
await new Promise((resolve) => web.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${web.address().port}`;
const token = await passwordUser(origin, "demo@example.test", "Demo");
const me = await (
  await fetch(origin + "/api/me", { headers: { "x-verynize-session": token } })
).json();
const browser = await launchBrowser();
const urls = {};
try {
  const context = await signedInContext(
    browser,
    origin,
    { session: token, ...me },
    { viewport: { width: 1440, height: 870 }, deviceScaleFactor: 2 },
  );
  const page = await context.newPage();
  const ready = () =>
    page.waitForFunction(
      () =>
        document.documentElement.dataset.uiReady === "true" &&
        window.shellRouter?.state.status === "idle",
      null,
      { timeout: 30000 },
    );
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(origin + "/editor");
  try {
    await ready();
  } catch (e) {
    console.log(
      await page.evaluate(() =>
        JSON.stringify({
          ds: document.documentElement.dataset,
          path: location.pathname,
          st: window.shellRouter?.state.status,
          text: document.body.innerText.slice(0, 300),
        }),
      ),
    );
    throw e;
  }
  const ids = await page.evaluate(async () => {
    const base = window.design.getDocument();
    const mk = (name, title, color) => ({
      ...structuredClone(base),
      name,
      pages: [
        {
          id: "p1",
          name: "Desktop",
          background: "#F5F3EE",
          nodes: [
            {
              id: "t1",
              type: "text",
              name: "Heading",
              x: 120,
              y: 120,
              w: 620,
              h: 120,
              text: title,
              fontSize: 56,
              color: "#111111",
            },
            {
              id: "r1",
              type: "rectangle",
              name: "Card",
              x: 120,
              y: 300,
              w: 420,
              h: 300,
              fill: color,
              radius: 24,
            },
          ],
        },
      ],
      activePage: "p1",
    });
    const a = await window.fileLibrary.createFromDocument(
      mk("Sample A", "Sample A design", "#9B7FE0"),
    );
    const b = await window.fileLibrary.createFromDocument(
      mk("Sample B", "Sample B design", "#E0A23B"),
    );
    await window.fileLibrary.open(a);
    return { a, b };
  });
  const shot = async (name) => {
    await page.waitForTimeout(400);
    urls[name] = await page.evaluate(() => location.href);
    await page.screenshot({ path: path.join(out, name + ".png") });
  };
  await shot("web-tab-a");
  await page.locator(`[data-file-tab="${ids.b}"]:not([data-document-tab])`).click();
  await page.waitForFunction((id) => window.fileLibrary.currentId === id, ids.b);
  await shot("web-tab-b");
  await page.goBack();
  await page.waitForFunction((id) => window.fileLibrary.currentId === id, ids.a);
  await shot("web-back-to-a");
  await page.goto(origin + "/editor/" + ids.b);
  await ready();
  await page.waitForFunction((id) => window.fileLibrary.currentId === id, ids.b);
  await shot("web-deeplink-b");
  await page.goto(origin + "/editor/does-not-exist");
  await ready();
  await page.waitForFunction(() => location.pathname === "/");
  await page.waitForTimeout(300);
  await shot("web-unknown-id");
  await fs.writeFile(path.join(out, "urls-web.json"), JSON.stringify(urls, null, 2) + "\n");
  console.log(JSON.stringify(urls, null, 2));
} finally {
  await browser.close();
  web.close();
  await backend.dispose();
  await fs.rm(temp, { recursive: true, force: true });
}
