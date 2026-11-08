import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForUiReady } from "./helpers/ui-ready.cjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-switch-cache-"));
const options = await cloudOptions(path.join(dir, "state")),
  apps = [];
let mf = new Miniflare(options);
try {
  const server = (await mf.ready).origin;
  const document = {
    version: 2,
    name: "Cached room",
    activePage: "p1",
    tokens: {},
    pages: [
      {
        id: "p1",
        name: "One",
        nodes: [
          {
            id: "n",
            type: "rectangle",
            name: "Original",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            color: "#ff0000",
          },
        ],
      },
      { id: "p2", name: "Two", nodes: [] },
    ],
  };
  const room = await (
    await fetch(server + "/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document }),
    })
  ).json();
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const name of ["a", "b"])
    apps.push(
      await _electron.launch({
        env,
        args: [
          ".",
          `--user-data-dir=${path.join(dir, name)}`,
          ...(name === "a"
            ? [
                `verynize://join?invite=${encodeURIComponent(`${server}/#room=${room.id}&token=${room.token}`)}`,
              ]
            : []),
        ],
      }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  for (const page of [a, b]) page.setDefaultTimeout(20000);
  await waitForUiReady(a);
  await a.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, room.id);
  assert.equal(
    await a.evaluate(() => document.body.classList.contains("files-view")),
    false,
    "a cold-start design link opens its editor without a Home click",
  );
  const cold = [];
  for (const p of [a, b]) {
    await waitForUiReady(p);
    cold.push(
      await p.evaluate(
        async (info) => {
          const start = performance.now();
          await window.cloudWorkspace.openRoom(info);
          return performance.now() - start;
        },
        { server, id: room.id, token: room.token },
      ),
    );
  }
  await b.evaluate(async () => {
    const doc = window.design.getDocument();
    doc.name = "Local";
    await window.fileLibrary.createFromDocument(doc);
  });
  await a.evaluate(() => window.design.updateNodes(["n"], { name: "Remote while away" }));
  await a.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0);
  await b.evaluate(() => {
    window.cacheObservations = [];
    window.addEventListener("switch-loading-change", (e) => {
      if (e.detail.info?.freshness === "provisional")
        window.cacheObservations.push({
          phase: e.detail.phase,
          model: window.design.getDocument().name,
          pending: window.cloudWorkspace.pendingCount(),
        });
    });
  });
  await b.evaluate(() => {
    window.fileLibrary.showHome();
    window.__cloudOpeningPaint = null;
    window.addEventListener("switch-loading-change", function observe(event) {
      if (event.detail.phase !== "begin" || event.detail.reason !== "home") return;
      window.removeEventListener("switch-loading-change", observe);
      requestAnimationFrame(() => {
        window.__cloudOpeningPaint = {
          home: document.body.classList.contains("files-view"),
          logo: getComputedStyle(document.getElementById("switch-loading-logo")).display,
          document: window.design.getDocument().name,
        };
      });
    });
  });
  const timing = await b.evaluate(
    async (info) => {
      const start = performance.now();
      await window.fileLibrary.open(window.fileLibrary.findCloud(info.server, info.id));
      return { total: performance.now() - start, marks: window.switchCoordinator.getState().marks };
    },
    { server, id: room.id, token: room.token },
  );
  await b.waitForFunction(
    () => window.design.getDocument().pages[0].nodes[0].name === "Remote while away",
  );
  assert.deepEqual(
    await b.evaluate(() => window.__cloudOpeningPaint),
    {
      home: false,
      logo: "flex",
      document: "Local",
    },
    "cloud Home opening paints the editor logo before fetching/replacing the document",
  );
  const observations = await b.evaluate(() => window.cacheObservations);
  assert.ok(
    observations.some((x) => x.phase === "ready" && x.model === "Local"),
    "cached presentation leaves authoritative model untouched",
  );
  assert.equal(await b.evaluate(() => window.cloudWorkspace.pendingCount()), 0);
  await b.evaluate(() => window.design.setActivePage("p2"));
  await a.evaluate(() => window.design.updateNodes(["n"], { name: "Inactive page update" }));
  await a.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0);
  await b.waitForFunction(
    () => window.design.getDocument().pages[0].nodes[0].name === "Inactive page update",
  );
  await b.evaluate(() => window.design.setActivePage("p1"));
  assert.equal(await b.locator('#canvas [data-id="n"]').count(), 1);
  await Promise.all([
    a.evaluate(() => window.design.updateNodes(["n"], { name: "Concurrent A" })),
    b.evaluate(() => window.design.updateNodes(["n"], { name: "Concurrent B" })),
  ]);
  for (const p of [a, b]) await p.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0);
  const serverDoc = await (
    await fetch(server + "/api/rooms/" + room.id, {
      headers: { Authorization: "Bearer " + room.token },
    })
  ).json();
  for (const p of [a, b])
    await p.waitForFunction(
      (name) => window.design.getDocument().pages[0].nodes[0].name === name,
      serverDoc.document.pages[0].nodes[0].name,
    );
  await mf.dispose();
  await b.evaluate(() => window.design.addNode("rectangle", { name: "Durable pending" }));
  await b.evaluate(
    async (info) => {
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        const stored = await window.cloudWorkspace.storedOutbox(info.server, info.id);
        if (
          stored?.pending?.some((batch) =>
            batch.ops.some((op) => JSON.stringify(op).includes("Durable pending")),
          )
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error("Pending operation was not persisted");
    },
    { server, id: room.id },
  );
  const retained = await b.evaluate(
    async (info) => {
      const before = await window.cloudWorkspace.storedOutbox(info.server, info.id);
      for (let i = 0; i < 12; i++)
        window.switchCache.put("eviction-" + i, window.design.getDocument());
      return (
        JSON.stringify(before) ===
        JSON.stringify(await window.cloudWorkspace.storedOutbox(info.server, info.id))
      );
    },
    { server, id: room.id },
  );
  assert.equal(retained, true, "presentation eviction does not touch durable batches");
  await apps.pop().evaluate(({ app }) => app.exit(0));
  mf = new Miniflare({ ...options, port: Number(new URL(server).port) });
  await mf.ready;
  const restarted = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "b")}`],
  });
  apps.push(restarted);
  const recovered = await restarted.firstWindow();
  await waitForUiReady(recovered);
  recovered.setDefaultTimeout(20000);
  assert.equal(await recovered.locator("#file-home").isVisible(), true);
  await recovered.locator(`#file-home [data-room-id="${room.id}"] .file-open`).click();
  await recovered.waitForFunction(
    () => window.cloudWorkspace.isConnected() && window.cloudWorkspace.pendingCount() === 0,
  );
  await recovered.waitForFunction(() =>
    window.design.getDocument().pages[0].nodes.some((n) => n.name === "Durable pending"),
  );
  await a.waitForFunction(() =>
    window.design.getDocument().pages[0].nodes.some((n) => n.name === "Durable pending"),
  );
  console.log("Room cold switch milliseconds:", cold);
  console.log("Room warm switch milliseconds:", JSON.stringify(timing));
  console.log("cloud-switch-cache passed");
} finally {
  for (const app of apps) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
