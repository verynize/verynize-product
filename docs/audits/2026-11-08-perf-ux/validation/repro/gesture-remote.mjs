// Gesture vs. remote edit, two real clients on production (audit 2026-11-08, validation).
//
// Client "desktop": the Verynize dev app started with `npx electron . --remote-debugging-port=$DESKTOP_PORT`
// (default userData, signed in). Client "web": a separate headless Google Chrome on a temporary copy of the
// browser profile's Verynize Local Storage/IndexedDB, started with --remote-debugging-port=$WEB_PORT. Both must
// already have the room open (window.cloudWorkspace.room().id === ROOM) and the AUDIT-drag-* nodes present.
//
//   ROOM=<audit-room-id> DESKTOP_PORT=9333 WEB_PORT=9334 GESTURER=desktop SCEN=drag,resize,text node gesture-remote.mjs
//   ROOM=<audit-room-id> SCEN=latency node gesture-remote.mjs
//
// Nothing outside the AUDIT room is touched. Output: gesture-results-<gesturer>-<scen>.json next to this file,
// with only node ids/geometry/text of the AUDIT-drag-* nodes, timings and websocket frame sizes (no payloads).
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(ROOT + "/package.json");
const { chromium } = require("@playwright/test");

const ROOM = process.env.ROOM; // id of "AUDIT collab test (delete me)" (not stored here)
if (!ROOM) throw Error("set ROOM to the AUDIT room id");
const GESTURER = process.env.GESTURER || "desktop";
const SCEN = (process.env.SCEN || "drag,resize,text").split(",");
const REPS = Number(process.env.REPS || 3);
const CONTROLS = Number(process.env.CONTROLS || 2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, "..", "screens");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

async function connect(port, label) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => /app:\/\/verynize|verynize\.gayaloo\.app/.test(p.url()));
  if (!page) throw Error(`${label}: no Verynize page`);
  const room = await page.evaluate(() => window.cloudWorkspace?.room()?.id);
  if (room !== ROOM) throw Error(`${label}: AUDIT room is not open (got ${room})`);
  // Websocket frames: direction, time and size only.
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  await cdp.send("Network.enable");
  const frame = (dir) => (e) => {
    let type = "?";
    let ops = 0;
    try {
      const m = JSON.parse(e.response.payloadData);
      type = m.type;
      ops = Array.isArray(m.ops) ? m.ops.length : 0;
    } catch {}
    frames.push({
      dir,
      t: e.timestamp,
      wall: Date.now(),
      type,
      ops,
      bytes: e.response.payloadData.length,
    });
  };
  cdp.on("Network.webSocketFrameSent", frame("sent"));
  cdp.on("Network.webSocketFrameReceived", frame("recv"));
  return { label, browser, page, frames };
}

// In-page probe: wraps window.design.setDocument (the remote-apply path, web/cloud-panel.js apply()) and records
// pointer events plus the dragged layer element on every pointermove.
const PROBE = (names) => {
  if (!window.__audit) {
    const now = () => performance.timeOrigin + performance.now();
    const a = { log: [], ids: {}, now };
    const D = window.design;
    const orig = D.setDocument.bind(D);
    D.setDocument = function (doc) {
      const t0 = now();
      const r = orig.apply(this, arguments);
      const t1 = now();
      const nodes = doc?.pages?.flatMap((p) => p.nodes || []) || [];
      const watch = {};
      for (const [k, id] of Object.entries(a.ids)) {
        const n = nodes.find((n) => n.id === id);
        if (n) watch[k] = { x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, text: n.text };
      }
      a.log.push({ ev: "setDocument", t0, t1, ms: Math.round(t1 - t0), watch });
      return r;
    };
    const el = () => document.querySelector(`#canvas [data-id="${a.ids.A}"].layer`);
    let held = null;
    for (const type of ["pointerdown", "pointerup"])
      window.addEventListener(
        type,
        (e) => {
          held = type === "pointerdown" ? el() : held;
          a.log.push({ ev: type, t: now(), x: e.clientX, y: e.clientY });
        },
        true,
      );
    window.addEventListener(
      "pointermove",
      (e) => {
        if (!(e.buttons & 1) || !a.track) return;
        const cur = document.querySelector(`#canvas [data-id="${a.track}"].layer`);
        const r = cur?.getBoundingClientRect();
        a.log.push({
          ev: "move",
          t: now(),
          x: e.clientX,
          y: e.clientY,
          layer: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          dragging: cur?.hasAttribute("data-dragging") || false,
        });
      },
      true,
    );
    window.__audit = a;
  }
  const nodes = window.design.getDocument().pages.flatMap((p) => p.nodes);
  for (const [k, name] of Object.entries(names))
    window.__audit.ids[k] = nodes.find((n) => n.name === name)?.id;
  return window.__audit.ids;
};
const NAMES = { A: "AUDIT-drag-A", B: "AUDIT-drag-B", R: "AUDIT-drag-R", T: "AUDIT-drag-T" };

const desktop = await connect(Number(process.env.DESKTOP_PORT || 9333), "desktop");
const web = await connect(Number(process.env.WEB_PORT || 9334), "web");
const G = GESTURER === "desktop" ? desktop : web;
const R = GESTURER === "desktop" ? web : desktop;
const ids = await G.page.evaluate(PROBE, NAMES);
await R.page.evaluate(PROBE, NAMES);
if (Object.values(ids).some((v) => !v))
  throw Error("AUDIT-drag-* nodes missing: " + JSON.stringify(ids));
log("ids", JSON.stringify(ids), "gesturer", G.label);

const node = (c, key) =>
  c.page.evaluate((id) => {
    const n = window.design
      .getDocument()
      .pages.flatMap((p) => p.nodes)
      .find((n) => n.id === id);
    return n && { x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, text: n.text };
  }, ids[key]);
// Server truth (fresh GET of the room through the desktop client's account session).
const server = () =>
  desktop.page.evaluate(
    async ({ room, ids }) => {
      const r = await window.cloudWorkspace.readFile({
        server: "https://verynize.gayaloo.app",
        roomId: room,
      });
      const nodes = r.document.pages.flatMap((p) => p.nodes);
      const out = { revision: r.revision };
      for (const [k, id] of Object.entries(ids)) {
        const n = nodes.find((n) => n.id === id);
        out[k] = n && { x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, text: n.text };
      }
      return out;
    },
    { room: ROOM, ids },
  );
const status = (c) => c.page.evaluate(() => document.getElementById("cloud-status")?.textContent);
const center = (c, key) =>
  c.page.evaluate((id) => {
    const r = document.querySelector(`#canvas [data-id="${id}"].layer`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, ids[key]);
const setNode = (c, key, patch) =>
  c.page.evaluate(({ id, patch }) => window.design.updateNodes([id], patch), {
    id: ids[key],
    patch,
  });
const clearLog = (c, track) =>
  c.page.evaluate((track) => {
    window.__audit.log = [];
    window.__audit.track = track;
  }, track);
const takeLog = (c) => c.page.evaluate(() => window.__audit.log);
let colorN = 0;
const COLORS = ["#c0392b", "#27ae60", "#2980b9", "#8e44ad", "#d35400", "#16a085"];
// The remote edit: a normal local edit on the other client (goes out through its own send path).
const remoteEdit = () => {
  const color = COLORS[colorN++ % COLORS.length];
  return R.page
    .evaluate(
      ({ id, color }) => {
        const t = performance.timeOrigin + performance.now();
        window.design.updateNodes([id], { color });
        return t;
      },
      { id: ids.B, color },
    )
    .then((t) => ({ color, t }));
};
const camera = async (c) => {
  await c.page.evaluate(() => {
    window.design.setSelection([]);
    window.design.setCamera(2000, 1400, 1);
  });
  await sleep(400);
};
const shot = async (c, name) => {
  // Only the canvas region around the AUDIT-drag-* nodes. Collaborator cursors (they carry the account name) are
  // hidden for the capture; sidebars, inspector and avatars stay outside the clip.
  // A fixed view of world (-2020…-1350, -1360…-700) at zoom 0.85, clipped to the canvas between the panels.
  await c.page.evaluate((idA) => {
    const st = document.createElement("style");
    st.id = "audit-shot";
    st.textContent = ".collaborator-cursor{display:none!important}";
    document.head.append(st);
    const k = (window.__auditCam = window.design.getCamera());
    // Screen offset of the world origin (canvas position in the window), from node A's layer.
    const a = window.design
      .getDocument()
      .pages.flatMap((p) => p.nodes)
      .find((n) => n.id === idA);
    const ra = document.querySelector(`#canvas [data-id="${idA}"].layer`).getBoundingClientRect();
    const ox = ra.x - (a.x * k.zoom + k.x),
      oy = ra.y - (a.y * k.zoom + k.y);
    window.design.setCamera(520 - ox + 2020 * 0.85, 120 - oy + 1360 * 0.85, 0.85);
  }, ids.A);
  await sleep(1500);
  const r = { x: 520, y: 120, width: 620, height: 570 };
  const file = path.join(SHOTS, `gesture-${name}.png`);
  await c.page.screenshot({ path: file, clip: r });
  await c.page.evaluate(() => {
    document.getElementById("audit-shot")?.remove();
    const k = window.__auditCam;
    window.design.setCamera(k.x, k.y, k.zoom);
  });
  return path.relative(path.join(HERE, ".."), file);
};
const settle = async (ms = 1800) => {
  await sleep(ms);
};
const summarize = (events, pointerupT, frames = []) => {
  const sets = events.filter((e) => e.ev === "setDocument");
  const down = events.find((e) => e.ev === "pointerdown")?.t;
  const up = pointerupT ?? events.find((e) => e.ev === "pointerup")?.t;
  return {
    upAtMs: down && up ? Math.round(up - down) : null,
    allSetDocuments: sets.map((e) => ({ atMs: Math.round(e.t0 - down), ms: e.ms })),
    gesturerWsFrames: frames
      .filter((f) => f.type !== "presence" && f.type !== "cursor")
      .map((f) => ({
        dir: f.dir,
        atMs: Math.round(f.wall - down),
        type: f.type,
        ops: f.ops,
        bytes: f.bytes,
      })),
    setDocumentDuringGesture: sets
      .filter((e) => e.t0 > down && e.t0 < up)
      .map((e) => ({ atMs: Math.round(e.t0 - down), ms: e.ms, B: e.watch.B?.color })),
    setDocumentAfterRelease: sets
      .filter((e) => e.t0 >= up)
      .map((e) => ({ afterUpMs: Math.round(e.t0 - up), ms: e.ms, A: e.watch.A, R: e.watch.R })),
    gestureMs: down && up ? Math.round(up - down) : null,
  };
};

const results = {
  gesturer: G.label,
  remote: R.label,
  room: "AUDIT collab test (delete me)",
  ids,
  startedAt: new Date().toISOString(),
  trials: [],
};
const original = {
  A: { x: -1800, y: -1200, w: 120, h: 80 },
  R: { x: -1800, y: -1000, w: 120, h: 80 },
  T: { text: "Hello" },
};
const reset = async () => {
  await setNode(G, "A", original.A);
  await setNode(G, "R", original.R);
  await setNode(G, "T", original.T);
  await settle(2000);
};

// Keep the gesture alive (pointer jiggles 1 px around its final position) until the gesturing client has applied the
// remote edit, so the edit lands mid-gesture even when the other client sends late. Capped at 25 s.
async function holdUntilRemote(fx, fy, editP) {
  if (!editP) return { heldMs: 0 };
  const edit = await editP;
  const t0 = Date.now();
  let seen = false;
  while (Date.now() - t0 < 25000) {
    seen =
      (await G.page.evaluate(
        (id) =>
          window.design
            .getDocument()
            .pages.flatMap((p) => p.nodes)
            .find((n) => n.id === id)?.color,
        ids.B,
      )) === edit.color;
    if (seen) break;
    await G.page.mouse.move(fx + 1, fy);
    await sleep(70);
    await G.page.mouse.move(fx, fy);
    await sleep(70);
  }
  for (let i = 0; i < 3; i++) {
    await G.page.mouse.move(fx + 1, fy);
    await sleep(70);
    await G.page.mouse.move(fx, fy);
    await sleep(70);
  }
  return { heldMs: Date.now() - t0, seenBeforeRelease: seen };
}

// ---- 1. drag ----
async function drag(withRemote, n) {
  await camera(G);
  const a0 = await node(G, "A");
  const c = await center(G, "A");
  await clearLog(G, ids.A);
  await clearLog(R, null);
  G.frames.length = 0;
  const STEPS = 19,
    DX = -10,
    DY = -7; // 19 moves → (-190, -133) at zoom 1, 70 ms apart (~1.4 s)
  let edit = null;
  const tAudit = () => G.page.evaluate(() => window.__audit.now());
  await G.page.mouse.move(c.x, c.y);
  await G.page.mouse.down();
  const tDown = await tAudit();
  for (let i = 1; i <= STEPS; i++) {
    await G.page.mouse.move(c.x + i * DX, c.y + i * DY);
    if (withRemote && i === 6) edit = remoteEdit();
    await sleep(70);
  }
  const hold = await holdUntilRemote(c.x + STEPS * DX, c.y + STEPS * DY, edit);
  const preUp = await G.page.evaluate((id) => {
    const el = document.querySelector(`#canvas [data-id="${id}"].layer`);
    const r = el.getBoundingClientRect();
    return {
      layer: [Math.round(r.x), Math.round(r.y)],
      dragging: el.hasAttribute("data-dragging"),
    };
  }, ids.A);
  await G.page.mouse.up();
  const tUp = await tAudit();
  edit = edit && (await edit);
  await settle();
  const events = await takeLog(G);
  const rEvents = await takeLog(R);
  const a1 = await node(G, "A");
  const aR = await node(R, "A");
  const srv = await server();
  const expected = { x: a0.x + STEPS * DX, y: a0.y + STEPS * DY };
  const shotName = withRemote && n === 0 ? await shot(G, `drag-${G.label}-after`) : null;
  return {
    scenario: "drag",
    withRemote,
    before: a0,
    expected,
    gesturerAfter: { x: a1.x, y: a1.y },
    remoteClientAfter: { x: aR.x, y: aR.y },
    serverAfter: { x: srv.A.x, y: srv.A.y },
    moved: a1.x !== a0.x || a1.y !== a0.y,
    matchesExpected: Math.abs(a1.x - expected.x) < 1 && Math.abs(a1.y - expected.y) < 1,
    preUp,
    hold,
    remoteEdit: edit && {
      color: edit.color,
      atMsAfterDown: Math.round(edit.t - tDown),
      seenOnGesturer: (await node(G, "B")).color === edit.color,
    },
    ...summarize(events, tUp, G.frames),
    moveSamples: events
      .filter((e) => e.ev === "move")
      .map((e) => ({ t: Math.round(e.t - tDown), layer: e.layer, dragging: e.dragging })),
    remoteClientSetDocuments: rEvents
      .filter((e) => e.ev === "setDocument")
      .map((e) => ({
        afterUpMs: Math.round(e.t0 - tUp),
        A: e.watch.A && { x: e.watch.A.x, y: e.watch.A.y },
      })),
    status: await status(G),
    shot: shotName,
  };
}

// ---- 2. resize (south-east handle) ----
async function resize(withRemote, n) {
  await camera(G);
  await G.page.evaluate((id) => window.design.setSelection([id]), ids.R);
  await sleep(400);
  const r0 = await node(G, "R");
  const h = await G.page.evaluate(() => {
    const r = [
      ...document.querySelectorAll(
        '#canvas .handle[data-corner="se"], #canvas-overlay .handle[data-corner="se"], .handle[data-corner="se"]',
      ),
    ]
      .find((e) => e.getBoundingClientRect().width > 0)
      ?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (!h) return { scenario: "resize", withRemote, error: "no se handle" };
  await clearLog(G, ids.R);
  await clearLog(R, null);
  G.frames.length = 0;
  const STEPS = 19,
    DX = 6,
    DY = 4; // → (+114, +76)
  let edit = null;
  const tDown0 = await G.page.evaluate(() => window.__audit.now());
  await G.page.mouse.move(h.x, h.y);
  await G.page.mouse.down();
  for (let i = 1; i <= STEPS; i++) {
    await G.page.mouse.move(h.x + i * DX, h.y + i * DY);
    if (withRemote && i === 6) edit = remoteEdit();
    await sleep(70);
  }
  const hold = await holdUntilRemote(h.x + STEPS * DX, h.y + STEPS * DY, edit);
  await G.page.mouse.up();
  const tUp = await G.page.evaluate(() => window.__audit.now());
  edit = edit && (await edit);
  await settle();
  const events = await takeLog(G);
  const r1 = await node(G, "R");
  const rR = await node(R, "R");
  const srv = await server();
  const expected = { w: r0.w + STEPS * DX, h: r0.h + STEPS * DY };
  const shotName = withRemote && n === 0 ? await shot(G, `resize-${G.label}-after`) : null;
  return {
    scenario: "resize",
    withRemote,
    before: { w: r0.w, h: r0.h, x: r0.x, y: r0.y },
    expected,
    gesturerAfter: { w: r1.w, h: r1.h, x: r1.x, y: r1.y },
    remoteClientAfter: { w: rR.w, h: rR.h },
    serverAfter: { w: srv.R.w, h: srv.R.h },
    resized: r1.w !== r0.w || r1.h !== r0.h,
    matchesExpected: Math.abs(r1.w - expected.w) < 1 && Math.abs(r1.h - expected.h) < 1,
    remoteEdit: edit && { color: edit.color, atMsAfterDown: Math.round(edit.t - tDown0) },
    hold,
    ...summarize(events, tUp, G.frames),
    moveSamples: events
      .filter((e) => e.ev === "move")
      .map((e) => ({ t: Math.round(e.t - tDown0), layer: e.layer })),
    status: await status(G),
    shot: shotName,
  };
}

// ---- 3. text editing ----
async function text(withRemote, n) {
  await camera(G);
  const c = await center(G, "T");
  await G.page.mouse.click(c.x, c.y);
  await sleep(300);
  await G.page.mouse.dblclick(c.x, c.y);
  await G.page.waitForSelector("#canvas [data-text-editing]", { timeout: 5000 }).catch(() => {});
  if (!(await G.page.evaluate(() => !!document.querySelector("#canvas [data-text-editing]"))))
    await G.page.keyboard.press("Enter");
  await sleep(300);
  await G.page.keyboard.press("End");
  // Collapse the caret to the end of the text (dblclick selects the word; End alone did not collapse it).
  await G.page.evaluate(() => {
    const ed = document.querySelector("#canvas [data-text-editing]");
    if (!ed) return;
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await clearLog(G, null);
  await G.page.keyboard.type(" one", { delay: 40 });
  const caret = () =>
    G.page.evaluate(() => {
      const ed = document.querySelector("#canvas [data-text-editing]");
      const s = getSelection();
      let offset = null;
      if (ed && s.rangeCount && ed.contains(s.anchorNode)) {
        const r = document.createRange();
        r.selectNodeContents(ed);
        r.setEnd(s.anchorNode, s.anchorOffset);
        offset = r.toString().length;
      }
      return {
        editing: !!ed,
        text: ed?.textContent ?? null,
        caret: offset,
        sameElement: ed === window.__auditEditor,
        focused: !!ed && ed.contains(document.activeElement),
      };
    });
  await G.page.evaluate(
    () => (window.__auditEditor = document.querySelector("#canvas [data-text-editing]")),
  );
  const beforeRemote = await caret();
  let edit = null;
  if (withRemote) {
    edit = await remoteEdit();
    // Wait until the remote op is applied on this client (or 3 s).
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      if ((await node(G, "B")).color === edit.color) break;
      await sleep(50);
    }
    await sleep(150);
  } else await sleep(600);
  const afterRemote = await caret();
  await G.page.keyboard.type(" two", { delay: 40 });
  const afterTyping = await caret();
  const shotName = withRemote && n === 0 ? await shot(G, `text-${G.label}-editing`) : null;
  await G.page.keyboard.press("Escape");
  await settle();
  const t1 = await node(G, "T");
  const tR = await node(R, "T");
  const srv = await server();
  const events = await takeLog(G);
  return {
    scenario: "text",
    withRemote,
    expected: "Hello one two",
    gesturerAfter: t1.text,
    remoteClientAfter: tR.text,
    serverAfter: srv.T.text,
    matchesExpected: t1.text === "Hello one two",
    beforeRemote,
    afterRemote,
    afterTyping,
    remoteEdit: edit && { color: edit.color },
    setDocuments: events
      .filter((e) => e.ev === "setDocument")
      .map((e) => ({ ms: e.ms, T: e.watch.T?.text })),
    status: await status(G),
    shot: shotName,
  };
}

// ---- 4. latency (edit on G, visible on R) ----
async function latency() {
  const out = { single: [], burst: [] };
  await camera(R);
  for (let i = 0; i < 5; i++) {
    await clearLog(R, null);
    G.frames.length = 0;
    const color = COLORS[i % COLORS.length];
    const t0 = await G.page.evaluate(
      ({ id, color }) => {
        const t = performance.timeOrigin + performance.now();
        window.design.updateNodes([id], { color });
        return t;
      },
      { id: ids.B, color: i % 2 ? color : color.replace("#", "#0").slice(0, 7) },
    );
    await sleep(2500);
    const ev = (await takeLog(R)).filter((e) => e.ev === "setDocument");
    const first = ev[0];
    const sent = G.frames.find((f) => f.dir === "sent" && f.type === "ops");
    out.single.push({
      visibleMs: first ? Math.round(first.t1 - t0) : null,
      applyMs: first?.ms ?? null,
      firstSendAfterEditMs: sent ? Math.round(sent.wall - t0) : null,
    });
  }
  // Burst: one x edit per ~16 ms for ~1.5 s (like a stream of per-frame edits), then stop.
  for (let rep = 0; rep < 3; rep++) {
    await setNode(G, "B", { x: -1500, y: -1200 });
    await sleep(2000);
    await clearLog(R, null);
    G.frames.length = 0;
    const burst = await G.page.evaluate(async (id) => {
      const now = () => performance.timeOrigin + performance.now();
      const edits = [];
      const start = now();
      let i = 0;
      while (now() - start < 1500) {
        i++;
        window.design.updateNodes([id], { x: -1500 + i });
        edits.push({ i, t: now() });
        await new Promise((r) => setTimeout(r, 16));
      }
      return { edits, start, end: now() };
    }, ids.B);
    await sleep(3000);
    const ev = (await takeLog(R)).filter((e) => e.ev === "setDocument" && e.watch.B);
    const sends = G.frames.filter((f) => f.dir === "sent" && f.type === "ops");
    const lastI = burst.edits.at(-1).i;
    const firstSeen = ev[0];
    const finalSeen = ev.find((e) => e.watch.B.x === -1500 + lastI);
    out.burst.push({
      edits: burst.edits.length,
      durationMs: Math.round(burst.end - burst.start),
      sendsDuringBurst: sends.filter((f) => f.wall <= burst.end).length,
      sends: sends.map((f) => ({
        afterStartMs: Math.round(f.wall - burst.start),
        ops: f.ops,
        bytes: f.bytes,
      })),
      remoteAppliesDuringBurst: ev.filter((e) => e.t0 <= burst.end).length,
      remoteApplies: ev.map((e) => ({
        afterStartMs: Math.round(e.t1 - burst.start),
        x: e.watch.B.x,
        ms: e.ms,
      })),
      firstVisibleAfterFirstEditMs: firstSeen ? Math.round(firstSeen.t1 - burst.edits[0].t) : null,
      finalVisibleAfterLastEditMs: finalSeen
        ? Math.round(finalSeen.t1 - burst.edits.at(-1).t)
        : null,
    });
    log("burst", JSON.stringify(out.burst.at(-1)).slice(0, 400));
  }
  return out;
}

await reset();
if (SCEN.includes("shot-before")) {
  await camera(G);
  results.shotBefore = await shot(G, `before-${G.label}`);
}
for (const s of SCEN) {
  const fn = { drag, resize, text }[s];
  if (!fn) continue;
  // Interleave: control, remote, control, remote, remote (+ controls beyond).
  const plan = [];
  for (let i = 0; i < Math.max(REPS, CONTROLS); i++) {
    if (i < CONTROLS) plan.push(false);
    if (i < REPS) plan.push(true);
  }
  let k = 0;
  for (const withRemote of plan) {
    const r = await fn(withRemote, withRemote ? k++ : -1);
    results.trials.push(r);
    log(
      s,
      withRemote ? "remote" : "control",
      JSON.stringify({
        before: r.before,
        expected: r.expected,
        after: r.gesturerAfter,
        rc: r.remoteClientAfter,
        srv: r.serverAfter,
        ok: r.matchesExpected,
        during: r.setDocumentDuringGesture?.length,
        edit: r.remoteEdit,
      }),
    );
    await reset();
  }
}
if (SCEN.includes("latency")) results.latency = await latency();
results.finishedAt = new Date().toISOString();
const file = path.join(HERE, `gesture-results-${G.label}-${SCEN.join("+")}.json`);
await fs.writeFile(file, JSON.stringify(results, null, 1));
log("wrote", file);
process.exit(0);
