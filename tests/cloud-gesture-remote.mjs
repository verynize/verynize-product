// A collaborator's edit arriving in the middle of a gesture (audit 2026-11-08 P0 #7/#8, after the production repro
// docs/audits/2026-11-08-perf-ux/validation/repro/gesture-remote.mjs): two Electron clients in one room on a local
// workerd. Client A drags, resizes and types while client B edits; the edit is applied on A before A lets go.
// - drag: the layer keeps following the pointer and lands where it was dropped on A, B and the server; B sees the
//   layer move while A still holds it (positions stream during the drag); the remote edit is applied on A mid-drag.
// - resize: a remote edit of the layer being resized waits for the release, then both survive (size and colour).
// - text: the caret stays where it was when a remote edit arrives, for another layer or for the edited one; the
//   typed text lands in place and merges with the remote text range-wise.
// - send interval: a burst of edits (one per 16 ms for 1.5 s) reaches the other client while it lasts, repeated
//   edits of one property are coalesced, and a single edit is visible on the other client quickly.
// Remote edits never load the whole document on A (window.design.setDocument is not called).
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { moveOffCursor } = createRequire(import.meta.url)("./helpers/off-cursor.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-gesture-remote-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const apps = [];
const results = {};
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  env.VERYNIZE_CLOUD_SERVER = server;
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  await Promise.all(apps.map(moveOffCursor));
  await Promise.all([a, b].map((page) => page.waitForFunction(() => !!window.design)));
  await a.waitForFunction((s) => document.getElementById("cloud-server").value === s, server);
  await openSharedDesign(a);
  await a.locator("#cloud-create").click();
  await a.waitForFunction(() => document.getElementById("cloud-invite").value.includes("token="));
  const invite = await a.locator("#cloud-invite").inputValue();
  b.on("dialog", (dialog) => dialog.accept(dialog.type() === "prompt" ? invite : undefined));
  await openSharedDesign(b);
  await b.locator("#cloud-invite").fill(invite);
  await b.locator("#cloud-connect").click();
  await b.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  for (const page of [a, b]) await page.locator("#cloud-close").click();
  const roomId = new URLSearchParams(new URL(invite).hash.slice(1)).get("room");
  const ownerToken = await a.evaluate(
    () => window.fileLibrary.cloudOf(window.fileLibrary.currentId).token,
  );
  const serverNode = async (id) => {
    const r = await fetch(`${server}/api/rooms/${roomId}`, {
      headers: { authorization: "Bearer " + ownerToken },
    });
    return (await r.json()).document.pages.flatMap((p) => p.nodes).find((n) => n.id === id);
  };

  // Test layers on A, on a page without the starter layers (nothing to snap to: a drag lands where it was dropped).
  const ids = await a.evaluate(() => {
    const d = window.design;
    d.setSelection(d.getDocument().pages[0].nodes.map((n) => n.id));
    d.runCommand("edit.delete");
    d.setCamera(40, 60, 1);
    const make = (type, extra) => {
      const id = d.addNode(type, extra);
      d.setSelection([]);
      return id;
    };
    return {
      A: make("rectangle", { name: "A", x: 260, y: 160, w: 120, h: 80, color: "#336699" }),
      B: make("rectangle", { name: "B", x: 640, y: 160, w: 120, h: 80, color: "#999999" }),
      R: make("rectangle", { name: "R", x: 260, y: 360, w: 120, h: 80, color: "#669933" }),
      T: make("text", { name: "T", x: 260, y: 520, w: 400, h: 60, text: "Hello", fontSize: 24 }),
    };
  });
  const nodeOn = (page, id) =>
    page.evaluate(
      (id) =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.id === id),
      id,
    );
  const until = (page, fn, arg, timeout = 10_000) => page.waitForFunction(fn, arg, { timeout });
  const nodeIs = (page, id, values) =>
    until(
      page,
      ([id, values]) => {
        const n = window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.id === id);
        return !!n && Object.entries(values).every(([k, v]) => n[k] === v);
      },
      [id, values],
    );
  await nodeIs(b, ids.T, { text: "Hello" });
  for (const page of [a, b])
    await page.evaluate(() => {
      // Whole-document loads on this client, and every frame its socket sends.
      const d = window.design;
      // oxlint-disable-next-line typescript/unbound-method -- monkey-patch: the original is re-invoked with .apply(this)
      const load = d.setDocument;
      window.__loads = 0;
      d.setDocument = d.loadDocument = function (...args) {
        window.__loads++;
        return load.apply(this, args);
      };
      window.__sent = [];
      // oxlint-disable-next-line typescript/unbound-method -- monkey-patch: the original is re-invoked with .call(this)
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        try {
          const m = JSON.parse(data);
          if (m.type === "ops") window.__sent.push({ t: Date.now(), ops: m.ops });
        } catch {}
        return send.call(this, data);
      };
    });
  const center = (page, id) =>
    page.evaluate((id) => {
      const r = document.querySelector(`#canvas .layer[data-id="${id}"]`).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);
  const layerBox = (page, id) =>
    page.evaluate((id) => {
      const r = document.querySelector(`#canvas .layer[data-id="${id}"]`).getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    }, id);

  // ---- 1. drag ----------------------------------------------------------------------------------------------------
  {
    const a0 = await nodeOn(a, ids.A);
    const c = await center(a, ids.A);
    await a.mouse.move(c.x, c.y);
    await a.mouse.down();
    const STEPS = 19,
      DX = -10,
      DY = -7;
    let remoteDuringGesture = false;
    for (let i = 1; i <= STEPS; i++) {
      await a.mouse.move(c.x + i * DX, c.y + i * DY);
      await sleep(30);
      if (i === 6) {
        await b.evaluate((id) => window.design.updateNodes([id], { color: "#cc3300" }), ids.B);
        await nodeIs(a, ids.B, { color: "#cc3300" });
        remoteDuringGesture = true;
        // The layer still follows the pointer after the remote edit was applied.
        const before = await layerBox(a, ids.A);
        await a.mouse.move(c.x + i * DX - 20, c.y + i * DY);
        await sleep(30);
        const after = await layerBox(a, ids.A);
        assert.equal(
          after.x,
          before.x - 20,
          "the dragged layer follows the pointer after a remote edit",
        );
        await a.mouse.move(c.x + i * DX, c.y + i * DY);
      }
    }
    // B sees the layer moving while A still holds it.
    await until(
      b,
      ([id, x0]) =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.id === id).x !== x0,
      [ids.A, a0.x],
      5000,
    );
    results.dragStreamedBeforeRelease = true;
    await a.mouse.up();
    const expected = { x: a0.x + STEPS * DX, y: a0.y + STEPS * DY };
    assert.ok(remoteDuringGesture);
    const onA = await nodeOn(a, ids.A);
    assert.deepEqual({ x: onA.x, y: onA.y }, expected, "A: the drag lands where it was dropped");
    await nodeIs(b, ids.A, expected);
    await nodeIs(a, ids.B, { color: "#cc3300" });
    await until(a, () =>
      /Saved shared revision/.test(document.getElementById("cloud-status").textContent),
    );
    const s = await serverNode(ids.A);
    assert.deepEqual({ x: s.x, y: s.y }, expected, "server: the drag landed");
    assert.equal((await serverNode(ids.B)).color, "#cc3300");
    results.drag = { expected, a: { x: onA.x, y: onA.y } };
  }

  // ---- 2. resize, with a remote edit of the resized layer itself ----------------------------------------------------
  {
    await a.evaluate((id) => window.design.setSelection([id]), ids.R);
    const r0 = await nodeOn(a, ids.R);
    const h = await a.evaluate((id) => {
      const r = document
        .querySelector(`#canvas .layer[data-id="${id}"] > .handle[data-corner="se"]`)
        .getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, ids.R);
    const STEPS = 19,
      DX = 6,
      DY = 4;
    await a.mouse.move(h.x, h.y);
    await a.mouse.down();
    for (let i = 1; i <= STEPS; i++) {
      await a.mouse.move(h.x + i * DX, h.y + i * DY);
      await sleep(30);
      if (i === 6) {
        // One batch: R's colour (held on A until the release) and B's (applied at once, so A has the batch).
        await b.evaluate(
          ([r, bId]) =>
            window.design.updateNodes([r, bId], (n) => ({
              color: n.id === r ? "#123456" : "#00aa00",
            })),
          [ids.R, ids.B],
        );
        await nodeIs(a, ids.B, { color: "#00aa00" });
        assert.equal(
          (await nodeOn(a, ids.R)).color,
          r0.color,
          "the resized layer's remote edit waits",
        );
      }
    }
    await a.mouse.up();
    const expected = { w: r0.w + STEPS * DX, h: r0.h + STEPS * DY, color: "#123456" };
    for (const page of [a, b]) await nodeIs(page, ids.R, expected);
    await until(a, () =>
      /Saved shared revision/.test(document.getElementById("cloud-status").textContent),
    );
    const s = await serverNode(ids.R);
    assert.deepEqual(
      { w: s.w, h: s.h, color: s.color },
      expected,
      "server: size and colour both kept",
    );
    results.resize = expected;
    await a.evaluate(() => window.design.setSelection([]));
  }

  // ---- 3. text editing --------------------------------------------------------------------------------------------
  const caret = () =>
    a.evaluate(() => {
      const ed = document.querySelector("#canvas [data-text-editing]");
      const s = getSelection();
      if (!ed || !s.rangeCount || !ed.contains(s.anchorNode)) return { editing: !!ed, caret: null };
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.setEnd(s.anchorNode, s.anchorOffset);
      return {
        editing: true,
        text: ed.textContent,
        caret: r.toString().length,
        focused: ed.contains(document.activeElement),
      };
    });
  const startEditing = async () => {
    await a.evaluate((id) => window.design.setSelection([id]), ids.T);
    const c = await center(a, ids.T);
    await a.mouse.click(c.x, c.y);
    await a.keyboard.press("Enter");
    await a.waitForSelector("#canvas [data-text-editing]");
    await a.evaluate(() => {
      const ed = document.querySelector("#canvas [data-text-editing]"),
        r = document.createRange();
      r.selectNodeContents(ed);
      r.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
  };
  {
    // A remote edit of another layer while typing.
    await startEditing();
    await a.keyboard.type(" one", { delay: 20 });
    assert.deepEqual(await caret(), { editing: true, text: "Hello one", caret: 9, focused: true });
    await b.evaluate((id) => window.design.updateNodes([id], { color: "#0000ff" }), ids.B);
    await nodeIs(a, ids.B, { color: "#0000ff" });
    assert.deepEqual(await caret(), { editing: true, text: "Hello one", caret: 9, focused: true });
    await a.keyboard.type(" two", { delay: 20 });
    await a.keyboard.press("Escape");
    for (const page of [a, b]) await nodeIs(page, ids.T, { text: "Hello one two" });
    results.textOtherLayer = "Hello one two";
  }
  {
    // A remote edit of the text being typed: held until editing ends, then merged range-wise.
    await until(a, () =>
      /Saved shared revision/.test(document.getElementById("cloud-status").textContent),
    );
    await startEditing();
    await a.keyboard.type(" three", { delay: 20 });
    await b.evaluate(
      ([t, bId]) =>
        window.design.updateNodes([t, bId], (n) =>
          n.id === t ? { text: "Big " + n.text } : { color: "#ff00ff" },
        ),
      [ids.T, ids.B],
    );
    await nodeIs(a, ids.B, { color: "#ff00ff" });
    const during = await caret();
    assert.deepEqual(during, {
      editing: true,
      text: "Hello one two three",
      caret: 19,
      focused: true,
    });
    await a.keyboard.type("!", { delay: 20 });
    await a.keyboard.press("Escape");
    for (const page of [a, b]) await nodeIs(page, ids.T, { text: "Big Hello one two three!" });
    assert.equal((await serverNode(ids.T)).text, "Big Hello one two three!");
    results.textSameLayer = "Big Hello one two three!";
  }

  // ---- 4. send interval -------------------------------------------------------------------------------------------
  {
    await until(a, () =>
      /Saved shared revision/.test(document.getElementById("cloud-status").textContent),
    );
    await sleep(500);
    await a.evaluate((id) => {
      // When B's x changes on this client (renders without a document copy).
      window.__seen = [];
      let last = null;
      window.design.subscribe(() => {
        const n = window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.id === id);
        if (n.x !== last) window.__seen.push({ t: Date.now(), x: (last = n.x) });
      });
    }, ids.B);
    // A single edit.
    const single = [];
    for (let i = 0; i < 3; i++) {
      const t0 = await b.evaluate(
        ([id, x]) => {
          const t = Date.now();
          window.design.updateNodes([id], { x });
          return t;
        },
        [ids.B, 700 + i],
      );
      await nodeIs(a, ids.B, { x: 700 + i });
      const seen = await a.evaluate((x) => window.__seen.find((e) => e.x === x)?.t, 700 + i);
      single.push(seen - t0);
      await sleep(300);
    }
    // A burst: one edit every 16 ms for 1.5 s.
    await b.evaluate(() => (window.__sent.length = 0));
    await a.evaluate(() => (window.__seen.length = 0));
    const burst = await b.evaluate(async (id) => {
      const start = Date.now(),
        edits = [];
      let i = 0;
      while (Date.now() - start < 1500) {
        window.design.updateNodes([id], { x: 800 + ++i });
        edits.push(Date.now());
        await new Promise((r) => setTimeout(r, 16));
      }
      return { start, end: Date.now(), count: i, first: edits[0] };
    }, ids.B);
    await nodeIs(a, ids.B, { x: 800 + burst.count });
    const seen = await a.evaluate(() => window.__seen);
    const sent = await b.evaluate(() => window.__sent);
    const during = seen.filter((e) => e.t <= burst.end);
    const xOps = sent.flatMap((m) => m.ops).filter((op) => op.id === ids.B && op.key === "x");
    results.latency = {
      singleMs: single,
      burst: {
        edits: burst.count,
        sends: sent.length,
        sendsDuringBurst: sent.filter((m) => m.t <= burst.end).length,
        xOpsSent: xOps.length,
        updatesSeenDuringBurst: during.length,
        firstSeenAfterFirstEditMs: seen[0].t - burst.first,
        lastSeenAfterBurstMs: seen.at(-1).t - burst.end,
      },
    };
    console.log("latency", JSON.stringify(results.latency));
    for (const ms of single) assert.ok(ms < 1000, `a single edit is visible within 1 s (${ms} ms)`);
    assert.ok(burst.count > 40, "the burst made many edits");
    assert.ok(
      results.latency.burst.sendsDuringBurst >= 5,
      "edits are sent while the burst lasts, not once after it",
    );
    assert.ok(during.length >= 5, "the other client sees the burst while it lasts");
    assert.ok(
      results.latency.burst.firstSeenAfterFirstEditMs < 500,
      "the first edit shows at once",
    );
    assert.ok(xOps.length < burst.count, "repeated edits of one property are coalesced");
  }

  for (const page of [a, b])
    assert.equal(
      await page.evaluate(() => window.__loads),
      0,
      "remote edits never load the whole document",
    );
  for (const page of [a, b])
    assert.equal(await page.locator("#cloud-conflict").evaluate((e) => e.hidden), true);
  console.log("results", JSON.stringify(results));
  console.log(
    "PASS remote edits mid-gesture: drag follows the pointer, streams to the other client and lands; a resized layer's remote edit waits and both survive; the caret stays for remote edits to another or the same text, which merge range-wise; bursts are sent while they last and coalesced; no whole-document loads",
  );
} finally {
  await Promise.all(apps.map((app) => app.close()));
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
