// web/storage-limits.js: which data: URLs become room assets, the shared size of a document and
// the warnings at 80 % and over a limit (the same module the editor and the server load).
import test from "node:test";
import assert from "node:assert/strict";
import "../web/room-limits.js";
import "../web/storage-limits.js";

const L = globalThis.VerynizeStorageLimits;
const KiB = 1024;
const MiB = 1024 * KiB;
const b64 = (bytes) => "A".repeat(Math.ceil((bytes * 4) / 3 / 4) * 4);
const dataUrl = (mime, bytes) => `data:${mime};base64,${b64(bytes)}`;
const page = (id, nodes) => ({ id, name: `Page ${id}`, nodes });
const text = (id, length) => ({
  id,
  type: "text",
  name: id,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  text: "x".repeat(length),
});

test("page and document limits are the room's (web/room-limits.js, cloud/limits.js)", () => {
  const Room = globalThis.VerynizeRoomLimits;
  assert.equal(L.PAGE_LIMIT_BYTES, Room.PAGE_BYTES);
  assert.equal(L.DOCUMENT_LIMIT_BYTES, Room.DOCUMENT_BYTES);
  assert.equal(L.utf8Length("é€😀"), Room.bytes("é€😀"));
  assert.equal(L.ASSET_LIMIT_BYTES, 20 * MiB);
  assert.equal(L.INLINE_LIMIT_BYTES, 8 * KiB);
});

test("classify: large binaries become assets, small ones and text stay inline", () => {
  assert.equal(L.classify(dataUrl("image/png", 100)), "inline");
  assert.equal(L.classify(dataUrl("image/png", 20 * KiB)), "asset");
  assert.equal(L.classify(dataUrl("image/jpg", 20 * KiB)), "asset", "image/jpg is image/jpeg");
  assert.equal(L.classify(dataUrl("font/woff2", 20 * KiB)), "asset");
  assert.equal(L.classify(dataUrl("video/mp4", 20 * KiB)), "asset");
  assert.equal(L.classify(dataUrl("application/pdf", 20 * KiB)), "reject");
  assert.equal(L.classify(dataUrl("image/svg+xml", 20 * KiB)), "inline", "SVG up to 256 KB");
  assert.equal(L.classify(dataUrl("image/svg+xml", 300 * KiB)), "asset");
  assert.equal(L.classify(`data:text/plain,${"x".repeat(20 * KiB)}`), "inline");
  assert.equal(L.classify("x".repeat(20 * KiB)), "inline");
  assert.equal(L.parseDataUrl(dataUrl("image/jpg", 1)).mime, "image/jpeg");
});

test("measure counts asset binaries as URLs and skips text content", () => {
  const big = dataUrl("image/png", 1 * MiB);
  const doc = {
    version: 2,
    pages: [
      page("a", [
        { id: "i", type: "image", src: big },
        { ...text("t", 10), text: big },
      ]),
      page("b", [text("u", 1000)]),
    ],
  };
  const report = L.measure(doc);
  assert.equal(report.inline.count, 1, "the text node's content is not a binary");
  assert.ok(report.inline.bytes >= MiB - 4 && report.inline.bytes <= MiB + 4);
  assert.ok(report.pages[0].bytes > big.length, "the text copy still counts");
  assert.ok(report.pages[0].bytes < big.length + 4 * KiB, "the image counts as a URL");
  assert.ok(report.total >= report.pages[0].bytes + report.pages[1].bytes);
  assert.equal(L.utf8Length("é€😀"), 2 + 3 + 4);
});

test("problems: warn at 80 %, over above the limit, worst first, with the page named", () => {
  const ok = L.measure({ pages: [page("a", [text("t", 100 * KiB)])] });
  assert.deepEqual(L.problems(ok), []);
  const warn = L.measure({ pages: [page("a", [text("t", 17 * MiB)]), page("b", [])] });
  const w = L.problems(warn).find((p) => p.scope === "page");
  assert.equal(w.level, "warn");
  assert.equal(w.scope, "page");
  assert.equal(w.pageId, "a");
  assert.match(w.message, /Page “Page a” is 17 MB of the 20 MB page limit/);
  const over = L.measure({
    pages: [page("a", [text("t", 17 * MiB)]), page("b", [text("u", 21 * MiB)])],
  });
  const listed = L.problems(over);
  assert.deepEqual(
    listed.map((p) => [p.level, p.pageId]),
    [
      ["over", undefined],
      ["over", "b"],
      ["warn", "a"],
    ],
  );
  assert.match(listed[1].message, /over the 20 MB page limit\. Move content/);
  // Just over the limit never reads as the limit itself.
  const edge = L.problems(L.measure({ pages: [page("a", [text("t", 20 * MiB + 30 * KiB)])] }));
  assert.match(
    edge.find((p) => p.scope === "page").message,
    /is 20\.0\d MB, over the 20 MB page limit/,
  );
  assert.equal(L.level(16 * MiB, L.DOCUMENT_LIMIT_BYTES), "warn");
  assert.equal(L.level(21 * MiB, L.DOCUMENT_LIMIT_BYTES), "over");
});

test("binaries too large to upload and unsupported data are blocking problems", () => {
  const huge = dataUrl("image/png", 21 * MiB);
  const report = L.measure({ pages: [page("a", [{ id: "i", type: "image", src: huge }])] });
  assert.equal(report.inline.tooLarge.length, 1);
  assert.equal(report.inline.tooLarge[0].pageId, "a");
  const [problem] = L.problems(report);
  assert.equal(problem.level, "over");
  assert.equal(problem.scope, "asset");
  assert.match(problem.message, /over the 20 MB upload limit/);
  const pdf = L.measure({
    pages: [page("a", [{ id: "i", type: "image", src: dataUrl("application/pdf", 20 * KiB) }])],
  });
  assert.match(L.problems(pdf)[0].message, /cannot be shared/);
});

test("mapBinaries replaces asset binaries and keeps everything else", () => {
  const big = dataUrl("image/png", 20 * KiB);
  const small = dataUrl("image/png", 10);
  const doc = {
    pages: [page("a", [{ id: "i", src: big, fills: [{ src: big }, { src: small }], text: big }])],
  };
  const out = L.mapBinaries(doc, () => "URL");
  const node = out.pages[0].nodes[0];
  assert.equal(node.src, "URL");
  assert.equal(node.fills[0].src, "URL");
  assert.equal(node.fills[1].src, small);
  assert.equal(node.text, big);
  assert.equal(doc.pages[0].nodes[0].src, big, "the input is not changed");
});

test("operation batches obey UTF-8 bytes and count with envelope headroom", () => {
  const R = globalThis.VerynizeRoomLimits;
  const ops = Array.from({ length: 3 }, (_, i) => ({
    t: "node",
    id: String(i),
    value: "界".repeat(3_000_000),
  }));
  // Each operation is above the batch limit, so each travels alone, under the message limit.
  const groups = R.batchOps(ops);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.flat(), ops);
  for (const group of groups)
    assert.ok(
      R.bytes({ type: "ops", batch: Number.MAX_SAFE_INTEGER, ops: group }) < R.MESSAGE_BYTES,
    );
  // Several operations share a batch up to BATCH_BYTES (UTF-8, with the envelope).
  const halves = Array.from({ length: 3 }, (_, i) => ({
    t: "node",
    id: String(i),
    value: "界".repeat(600_000),
  }));
  const packed = R.batchOps(halves);
  assert.deepEqual(
    packed.map((b) => b.length),
    [2, 1],
  );
  for (const group of packed)
    assert.ok(
      R.bytes({ type: "ops", batch: Number.MAX_SAFE_INTEGER, ops: group }) <= R.BATCH_BYTES,
    );
  assert.deepEqual(
    R.batchOps(Array.from({ length: 8001 }, () => ({ t: "remove", id: "a" }))).map((b) => b.length),
    [R.BATCH_OPS, 8001 - R.BATCH_OPS],
  );
  assert.equal(R.batchOps([{ value: "界".repeat(8_000_000) }]), null);
});
