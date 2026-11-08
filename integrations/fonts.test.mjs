import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveFontFamily,
  ensureFonts,
  fontFaceCss,
  extractFontFamilies,
  fontId,
  familyKind,
  missingFonts,
  POPULAR_FONTS,
} from "./fonts.mjs";

const WOFF2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60, 7)]);
const meta = (id, family, { weights = [400, 700], styles = ["normal", "italic"] } = {}) => ({
  id,
  family,
  weights,
  styles,
  defSubset: "latin",
  category: "serif",
  license: { type: "OFL-1.1" },
  variants: Object.fromEntries(
    weights.map((w) => [
      w,
      Object.fromEntries(
        styles.map((s) => [
          s,
          {
            latin: {
              url: {
                woff2: `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${w}-${s}.woff2`,
              },
            },
          },
        ]),
      ),
    ]),
  ),
});
function fakeNet(fonts) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const m = url.match(/^https:\/\/api\.fontsource\.org\/v1\/fonts\/(.+)$/);
    if (m) return fonts[m[1]] ? Response.json(fonts[m[1]]) : new Response("{}", { status: 404 });
    if (url.endsWith(".woff2")) return new Response(WOFF2);
    return new Response("", { status: 500 });
  };
  return { fetch, calls };
}
const offlineFetch = async () => {
  throw new TypeError("fetch failed");
};
async function tmp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bd-fonts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("ids and family kinds", () => {
  assert.equal(fontId("Playfair Display"), "playfair-display");
  assert.equal(fontId("'Playfair_Display'"), "playfair-display");
  assert.equal(familyKind("system-ui"), "generic");
  assert.equal(familyKind("ui-monospace"), "generic");
  assert.equal(familyKind("Helvetica Neue"), "system");
  assert.equal(familyKind("Inter"), "bundled");
  assert.equal(familyKind("Geist"), "web");
  assert.ok(POPULAR_FONTS.length >= 120);
});

test("resolveFontFamily uses the API, caches metadata on disk, passes generics through", async (t) => {
  const cacheDir = await tmp(t);
  const net = fakeNet({ "playfair-display": meta("playfair-display", "Playfair Display") });
  const r = await resolveFontFamily("playfair display", { fetch: net.fetch, cacheDir });
  assert.deepEqual(
    [r.family, r.id, r.kind, r.available],
    ["Playfair Display", "playfair-display", "web", true],
  );
  const again = await resolveFontFamily("Playfair_Display", { fetch: offlineFetch, cacheDir });
  assert.equal(again.available, true);
  assert.equal(net.calls.length, 1);
  const generic = await resolveFontFamily("sans-serif", { fetch: offlineFetch, cacheDir });
  assert.deepEqual([generic.kind, generic.available], ["generic", true]);
  const nope = await resolveFontFamily("Totally Made Up", { fetch: net.fetch, cacheDir });
  assert.equal(nope.available, false);
  assert.match(nope.reason, /not a Google\/Fontsource font/);
});

test("offline: popular fonts stay available, unknown ones report the network reason", async (t) => {
  const cacheDir = await tmp(t);
  const lora = await resolveFontFamily("Lora", { fetch: offlineFetch, cacheDir });
  assert.deepEqual([lora.available, lora.offline, lora.family], [true, true, "Lora"]);
  const odd = await resolveFontFamily("Obscure Font X", { fetch: offlineFetch, cacheDir });
  assert.equal(odd.available, false);
  assert.match(odd.reason, /network: fetch failed/);
  const res = await ensureFonts(["Lora"], [400], { fetch: offlineFetch, cacheDir });
  assert.equal(res.loaded.length, 0);
  assert.equal(res.missing[0].family, "Lora");
});

test("ensureFonts downloads latin woff2 variants, snaps weights and caches", async (t) => {
  const cacheDir = await tmp(t);
  const net = fakeNet({
    "playfair-display": meta("playfair-display", "Playfair Display"),
    geist: meta("geist", "Geist", { styles: ["normal"] }),
  });
  const res = await ensureFonts(
    [
      "Playfair Display",
      { family: "'Geist', system-ui", weights: [500], styles: ["normal", "italic"] },
      "serif",
      "Inter",
    ],
    [400, 700],
    { fetch: net.fetch, cacheDir, styles: ["normal", "italic"] },
  );
  const got = res.loaded.map((l) => `${l.id}:${l.weight}:${l.style}:${l.source}`).sort();
  assert.deepEqual(got, [
    "geist:400:normal:download",
    "inter:400:italic:bundled",
    "inter:400:normal:bundled",
    "inter:700:italic:bundled",
    "inter:700:normal:bundled",
    "playfair-display:400:italic:download",
    "playfair-display:400:normal:download",
    "playfair-display:700:italic:download",
    "playfair-display:700:normal:download",
  ]);
  assert.ok(res.missing.some((m) => m.family === "Geist" && m.style === "italic"));
  assert.deepEqual(res.skipped, [{ family: "serif", kind: "generic" }]);
  const second = await ensureFonts(["Playfair Display"], [400], { fetch: offlineFetch, cacheDir });
  assert.equal(second.loaded[0].source, "cache");
});

test("ensureFonts rejects non-woff2 payloads and never throws on HTTP errors", async (t) => {
  const cacheDir = await tmp(t);
  const fetch = async (url) =>
    url.includes("api.fontsource") ? Response.json(meta("lora", "Lora")) : new Response("<html>");
  const res = await ensureFonts(["Lora"], [400], { fetch, cacheDir });
  assert.equal(res.loaded.length, 0);
  assert.match(res.missing[0].reason, /not a woff2/);
  const res2 = await ensureFonts(["Lora"], [700], {
    fetch: async (u) =>
      u.includes("api.") ? Response.json(meta("lora", "Lora")) : new Response("", { status: 503 }),
    cacheDir,
  });
  assert.match(res2.missing[0].reason, /HTTP 503/);
});

test("fontFaceCss embeds data URLs from cache and bundled Inter", async (t) => {
  const cacheDir = await tmp(t);
  const net = fakeNet({ "playfair-display": meta("playfair-display", "Playfair Display") });
  await ensureFonts(["Playfair Display"], [700], { fetch: net.fetch, cacheDir });
  const { css, faces, missing } = await fontFaceCss(
    [
      { family: "Playfair_Display", weights: [700] },
      { family: "Inter", weights: [400] },
      "system-ui",
    ],
    { cacheDir },
  );
  assert.match(
    css,
    /font-family:'Playfair Display';font-style:normal;font-weight:700;font-display:block;src:url\(data:font\/woff2;base64,/,
  );
  assert.match(css, /font-family:'Playfair_Display'/);
  assert.match(css, /font-family:'Inter';font-style:normal;font-weight:400/);
  assert.equal(faces.length, 2);
  assert.deepEqual(missing, []);
  const files = await fontFaceCss(["Playfair Display"], { cacheDir, weights: [700], embed: false });
  assert.match(files.css, /url\(file:\/\//);
  const none = await fontFaceCss(["Lora"], { cacheDir });
  assert.equal(none.css, "");
  assert.equal(none.missing[0].family, "Lora");
  assert.equal(net.calls.length, 2, "fontFaceCss never touches the network");
});

test("extractFontFamilies collects families, weights and italic/bold runs", async (t) => {
  const doc = {
    version: 2,
    pages: [
      {
        id: "p",
        nodes: [
          {
            id: "a",
            type: "text",
            text: "Hello world",
            fontFamily: "'Playfair Display', serif",
            fontWeight: "700",
            textRuns: [{ start: 0, end: 5, bold: false, italic: true }],
          },
          {
            id: "b",
            type: "text",
            text: "Body",
            fontFamily: "Inter",
            fontWeight: "400",
            textRuns: [{ start: 0, end: 4, bold: true, italic: false }],
          },
          {
            id: "c",
            type: "text",
            text: "Sys",
            fontFamily: "system-ui",
            fontWeight: "400",
            textRuns: [],
          },
          { id: "d", type: "frame", text: "", fontFamily: "Lobster" },
        ],
      },
    ],
  };
  assert.deepEqual(extractFontFamilies(doc), [
    { family: "Playfair Display", weights: [700], styles: ["italic", "normal"] },
    { family: "Inter", weights: [400, 700], styles: ["normal"] },
    { family: "system-ui", weights: [400], styles: ["normal"] },
  ]);
  const cacheDir = await tmp(t);
  const gaps = await missingFonts(
    {
      pages: [
        {
          nodes: [
            { type: "text", text: "x", fontFamily: "Nonexistent Sans" },
            { type: "text", text: "y", fontFamily: "Lora" },
          ],
        },
      ],
    },
    { fetch: offlineFetch, cacheDir },
  );
  assert.deepEqual(
    gaps.map((g) => g.family),
    ["Nonexistent Sans"],
  );
});
