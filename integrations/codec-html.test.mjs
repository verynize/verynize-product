// HTML + CSS import: external stylesheet resolution (local files, @import, http(s) from a real local
// server, with size/time limits and folder containment), the cascade (specificity, !important, @layer,
// inline styles, inheritance, custom properties, media queries for the import viewport), :root tokens
// and typed variables, Tailwind v4 utilities with responsive/state variants, and re-import of
// Verynize's own HTML export (lossless while unchanged, rebuilt from CSS once edited).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importHtml, importHtmlFrom, parseHtml } from "./codec-html.mjs";
import { parseStylesheet, parseSelectorList, matches, cascade } from "./codec-css-cascade.mjs";
import { matchMedia } from "./codec-css.mjs";
import { createArtboards, getPage } from "./design-edit.mjs";
import { documentToHtml } from "./codec-source.mjs";
import { exportHTML } from "./export-html.mjs";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const byName = (doc, name) => getPage(doc, doc.activePage).nodes.find((n) => n.name === name);
const textOf = (doc, text) =>
  getPage(doc, doc.activePage).nodes.find((n) => n.type === "text" && n.text === text);

function serve(routes) {
  const server = http.createServer((req, res) => {
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    const send = () => {
      res.writeHead(200, {
        "content-type": route.type || "text/css",
        ...(route.length ? { "content-length": String(route.length) } : {}),
      });
      res.end(route.body);
    };
    if (route.delay) setTimeout(send, route.delay);
    else send();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

test("selectors, specificity and the cascade order (layers, !important, inline)", () => {
  const tree = parseHtml(
    '<html><body><div id="a" class="x y" data-k="v"><p class="t">One</p><p>Two</p></div></body></html>',
  );
  const div = tree.children[0].children[0].children[0],
    [p1, p2] = div.children;
  const sel = (text) => parseSelectorList(text)[0];
  assert.ok(matches(p1, sel("#a > p.t:first-child")));
  assert.ok(matches(p2, sel(".x p:nth-child(2n)")));
  assert.ok(matches(p2, sel("p.t + p")));
  assert.ok(matches(div, sel('div[data-k="v"]:not(.z):is(.y, .w)')));
  assert.ok(matches(div, sel("div:has(> p.t)")));
  assert.ok(!matches(p1, sel("p:hover")), "state pseudo-classes never match at import");
  assert.ok(!matches(p1, sel("p::before")));
  assert.deepEqual(sel("#a .x:where(.q) p").spec, [1, 1, 1]);
  const won = cascade(
    [
      {
        property: "color",
        value: "red",
        origin: "author",
        spec: [1, 0, 0],
        order: 1,
        layerRank: 0,
      },
      { property: "color", value: "blue", origin: "author", spec: [0, 0, 1], order: 2 },
      {
        property: "margin-top",
        value: "1px",
        origin: "author",
        spec: [0, 1, 0],
        order: 3,
        important: true,
      },
      { property: "margin-top", value: "2px", origin: "inline", spec: [1, 0, 0], order: 4 },
      {
        property: "padding-top",
        value: "1px",
        origin: "author",
        spec: [0, 1, 0],
        order: 5,
        important: true,
        layerRank: 0,
      },
      {
        property: "padding-top",
        value: "2px",
        origin: "author",
        spec: [1, 0, 0],
        order: 6,
        important: true,
      },
    ],
    1,
  );
  assert.equal(won.get("color").value, "blue", "unlayered beats a layer whatever the specificity");
  assert.equal(won.get("margin-top").value, "1px", "!important beats inline");
  assert.equal(won.get("padding-top").value, "1px", "for !important, layers beat unlayered");
  const sheet = parseStylesheet(
    "@import url(a.css) layer(base) screen; @layer base, ui; @media (min-width: 600px) { .a { color: red } } .b { & .c { color: blue } }",
  );
  assert.equal(sheet.items[0].type, "import");
  assert.deepEqual(sheet.layers, ["base", "ui"]);
  assert.ok(sheet.items.some((i) => i.type === "rule" && i.selector === ".b .c"));
  assert.ok(matchMedia("(min-width: 600px) and (max-width: 900px)", { width: 700 }));
  assert.ok(!matchMedia("(prefers-color-scheme: dark)", { width: 700 }));
});

test("external stylesheets: <link>, nested @import with layer/media, local images, folder containment", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vn-html-"));
  try {
    mkdirSync(path.join(dir, "css"));
    mkdirSync(path.join(dir, "img"));
    writeFileSync(path.join(dir, "img", "dot.png"), PNG_1x1);
    writeFileSync(path.join(dir, "secret.css"), ".card { background: red }");
    writeFileSync(
      path.join(dir, "css", "base.css"),
      ".card { padding: 4px; color: #ff0000 } .hero { background-image: url(../img/dot.png) }",
    );
    writeFileSync(path.join(dir, "css", "wide.css"), ".card { border-radius: 20px }");
    writeFileSync(
      path.join(dir, "css", "main.css"),
      '@import url("base.css") layer(base);\n@import "wide.css" (min-width: 1000px);\n.card { padding: 24px; background-color: #f4f4f5 }\n@layer base { .card { color: #00ff00; margin-top: 3px } }',
    );
    const html = `<!doctype html><html><head><title>Local</title><link rel="stylesheet" href="css/main.css"><link rel="stylesheet" href="../${path.basename(dir)}-outside.css"></head>
      <body style="margin:0"><div class="hero" style="height:40px"></div><div class="card">Card text</div><img src="img/dot.png" width="10" alt="Dot"></body></html>`;
    writeFileSync(path.join(dir, "page.html"), html);
    const wide = await importHtmlFrom(path.join(dir, "page.html"), {
      viewport: { width: 1200, height: 800 },
    });
    const card = byName(wide.document, "div.card");
    assert.equal(card.padding, 24, "unlayered main.css beats the layered import");
    assert.equal(card.color, "#f4f4f5");
    assert.equal(card.radius, 20, "media-conditional @import applies at 1200px");
    assert.deepEqual(
      card.margin,
      [3, 0, 0, 0],
      "layered declarations still apply where nothing overrides them",
    );
    assert.equal(
      textOf(wide.document, "Card text").color,
      "#00ff00",
      "within a layer, later rules win",
    );
    const hero = byName(wide.document, "div.hero");
    assert.equal(
      hero.fills?.[0]?.type,
      "image",
      "background-image url() resolved relative to the stylesheet",
    );
    assert.match(hero.fills[0].src, /^data:image\/png;base64,/);
    const img = byName(wide.document, "Dot");
    assert.match(img.src, /^data:image\/png;base64,/, "local <img> embedded");
    assert.equal(img.w, 10);
    assert.ok(
      wide.warnings.some((w) => /outside the import folder|ENOENT|no such file/i.test(w)),
      "paths outside the page folder are refused",
    );
    const narrow = await importHtmlFrom(path.join(dir, "page.html"), {
      viewport: { width: 600, height: 800 },
    });
    assert.equal(
      byName(narrow.document, "div.card").radius,
      0,
      "the @import media query does not match at 600px",
    );
    // Containment: a link escaping the folder is not read even if the file exists.
    writeFileSync(
      path.join(dir, "sub.html"),
      '<link rel="stylesheet" href="secret.css"><div class="card">x</div>',
    );
    mkdirSync(path.join(dir, "inner"));
    writeFileSync(
      path.join(dir, "inner", "page.html"),
      '<link rel="stylesheet" href="../secret.css"><div class="card">Inner</div>',
    );
    const contained = await importHtmlFrom(path.join(dir, "inner", "page.html"));
    assert.ok(contained.warnings.some((w) => /outside the import folder/.test(w)));
    assert.notEqual(textOf(contained.document, "Inner")?.color, "#ff0000");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("remote stylesheets over http: opt-in, size limit and timeout", async () => {
  const big = ".x{color:red}".repeat(2000);
  const { server, url } = await serve({
    "/site.css": { body: '@import "/theme.css"; .btn { padding: 10px 20px; border-radius: 8px }' },
    "/theme.css": {
      body: ":root { --brand: #4f46e5 } .btn { background: var(--brand); color: white }",
    },
    "/big.css": { body: big },
    "/slow.css": { body: ".btn { color: red }", delay: 1500 },
    "/logo.png": { body: PNG_1x1, type: "image/png" },
  });
  try {
    const html = `<html><head><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/big.css"><link rel="stylesheet" href="/slow.css"></head><body><button class="btn">Buy</button><img src="/logo.png" alt="Logo"></body></html>`;
    const off = await importHtml(html, { baseUrl: `${url}/index.html` });
    assert.ok(
      off.warnings.some((w) => /remote loading is off/.test(w)),
      "remote CSS is not fetched unless allowed",
    );
    await assert.rejects(
      importHtml(html, { baseUrl: `${url}/index.html`, allowRemote: true, maxBytes: 4096 }),
      /exceeds limit 4096 bytes/,
    );
    const on = await importHtml(html.replace('<link rel="stylesheet" href="/big.css">', ""), {
      baseUrl: `${url}/index.html`,
      allowRemote: true,
      maxBytes: 4096,
      timeoutMs: 300,
    });
    const btn = byName(on.document, "button.btn");
    assert.deepEqual(
      [btn.paddingTop ?? btn.padding, btn.paddingLeft ?? btn.padding, btn.radius],
      [10, 20, 8],
    );
    assert.equal(
      btn.token,
      "brand",
      "a :root colour used through var() becomes a bound colour variable",
    );
    assert.equal(on.document.tokens.brand, "#4f46e5");

    assert.ok(
      on.warnings.some((w) => /slow\.css/.test(w) && /abort|timeout|timed out/i.test(w)),
      "time limit",
    );
    assert.match(
      byName(on.document, "Logo").src,
      /^data:image\//,
      "opted-in remote images are embedded during import",
    );
  } finally {
    server.close();
  }
});

test("inheritance, units, custom properties, typed variables and media queries for the viewport", async () => {
  const html = `<html><head><style>
    :root { --ink: #111827; --gap: 12px; --pad: 1.5rem; --font: "Inter", sans-serif; --heavy: 700; --muted: color-mix(in oklab, #000 50%, #fff) }
    html { font-size: 20px }
    body { margin: 0; color: var(--ink); font-family: var(--font); line-height: 1.5 }
    .stack { display: flex; flex-direction: column; gap: var(--gap); padding: var(--pad) }
    .stack > * { margin: 0 }
    h1 { font-size: 2rem; font-weight: var(--heavy); letter-spacing: -0.02em }
    .lead { font-size: 1.25em; color: var(--missing, #6b7280) }
    .note { color: var(--muted) }
    .wide { width: 50vw }
    .theme { --ink: #ff0000 } .theme p { color: var(--ink) }
    @media (max-width: 700px) { .stack { flex-direction: row } }
    @media (prefers-color-scheme: dark) { body { color: white } }
    .inherit-border { border: 2px solid #000 } .inherit-border > div { border-top-width: inherit; height: 4px }
  </style></head><body><main class="stack"><h1>Title</h1><p class="lead">Lead</p><p class="note">Note</p><div class="wide" style="height:10px"></div>
    <section class="theme"><p>Local ink</p></section><div class="inherit-border"><div></div></div></main></body></html>`;
  const desktop = await importHtml(html, { viewport: { width: 1000, height: 800 } });
  const d = desktop.document;
  const stack = byName(d, "main.stack");
  assert.equal(stack.layout, "flex");
  assert.equal(stack.direction, "column");
  assert.equal(stack.padding, 30, "1.5rem with a 20px root font size");
  assert.equal(stack.gap, 12);
  assert.deepEqual(
    stack.bindings,
    { padding: "pad", gap: "gap" },
    "typed variables bound to padding and gap",
  );
  assert.deepEqual(d.variables.gap, { type: "dimension", value: 12 });
  assert.deepEqual(d.variables.pad, { type: "dimension", value: 30 });
  const title = textOf(d, "Title");
  assert.equal(title.fontSize, 40);
  assert.equal(title.fontWeight, "700");
  assert.equal(
    title.letterSpacing,
    -0.8,
    "em letter-spacing resolved against the element font size",
  );
  assert.equal(title.fontFamily, '"Inter", sans-serif', "font-family inherited from <body>");
  assert.equal(title.color, "#111827", "colour inherited from <body>");
  assert.equal(title.bindings?.fontWeight, "heavy");
  assert.equal(textOf(d, "Lead").fontSize, 25, "em font size relative to the inherited 20px");
  assert.equal(textOf(d, "Lead").color, "#6b7280", "var() fallback");
  assert.equal(textOf(d, "Note").color, "#636363", "color-mix() resolved in oklab like browsers");
  assert.equal(byName(d, "div.wide").w, 500, "vw resolved against the import viewport");
  assert.equal(
    textOf(d, "Local ink").color,
    "#ff0000",
    "a custom property overridden in a subtree is resolved there, not bound to the root token",
  );
  assert.equal(textOf(d, "Local ink").token, "");
  const inner = getPage(d, d.activePage).nodes.find(
    (n) => n.parentId === byName(d, "div.inherit-border").id,
  );
  assert.equal(inner.strokeWidth, 2, "inherit on a non-inherited property copies the parent value");
  const phone = await importHtml(html, { viewport: { width: 600, height: 800 } });
  assert.equal(
    byName(phone.document, "main.stack").direction,
    "row",
    "max-width media query applies at 600px",
  );
  const dark = await importHtml(html, {
    viewport: { width: 1000, height: 800, colorScheme: "dark" },
  });
  assert.equal(textOf(dark.document, "Title").color, "#ffffff");
});

test("Tailwind pages: utilities, arbitrary values, theme tokens, responsive variants applied, state variants recorded", async () => {
  const html = `<html><head><script src="https://cdn.tailwindcss.com"></script></head><body class="m-0">
    <div class="hidden md:flex gap-x-[18px] p-4 bg-indigo-500 hover:bg-indigo-600 rounded-[10px] text-white">
      <p class="text-sm/6 font-semibold tracking-tight lg:text-lg">Promo</p>
    </div></body></html>`;
  const wide = await importHtml(html, { viewport: { width: 1280, height: 800 } });
  const box = getPage(wide.document, wide.document.activePage).nodes.find((n) => n.variantClasses);
  assert.equal(box.layout, "flex", "md:flex applies at 1280px (and un-hides the element)");
  assert.ok(!box.hidden);
  assert.equal(box.gapX ?? box.gap, 18);
  assert.equal(box.color, "#615fff", "theme colour from the real Tailwind engine");
  assert.equal(box.radius, 10);
  assert.equal(box.variantClasses, "md:flex hover:bg-indigo-600");
  const promo = textOf(wide.document, "Promo");
  assert.equal(promo.fontSize, 18, "lg:text-lg applies at 1280px");
  assert.equal(promo.variantClasses, "lg:text-lg");
  const narrow = await importHtml(html, { viewport: { width: 500, height: 800 } });
  const hidden = getPage(narrow.document, narrow.document.activePage).nodes.find((n) =>
    n.variantClasses?.includes("md:flex"),
  );
  assert.equal(hidden.hidden, true, "below md the base `hidden` wins");
  assert.equal(textOf(narrow.document, "Promo").fontSize, 14);
  // The recorded variants are written back by the JSX serializer.
  const back = createArtboards(
    { version: 2, name: "T", tokens: {}, pages: [{ id: "p", name: "P", nodes: [] }] },
    "p",
    '<div className="flex md:grid hover:opacity-50 p-2">x</div>',
  );
  const frame = back.document.pages[0].nodes[0];
  assert.equal(frame.variantClasses, "md:grid hover:opacity-50");
});

test("Verynize HTML export re-imports exactly; edited CSS rebuilds only that layer", async () => {
  const jsx = `<section data-node-label="Card" data-component-x="0" data-component-y="0" className="flex flex-col gap-3 p-6 w-[320px] bg-white rounded-xl shadow-md">
    <p data-node-label="Heading" className="text-xl font-semibold text-zinc-900">Plan</p>
    <p data-node-label="Body" className="text-sm text-zinc-500">Details</p></section>`;
  const source = createArtboards(
    {
      version: 2,
      name: "Export",
      activePage: "p",
      tokens: {},
      pages: [{ id: "p", name: "P", nodes: [] }],
    },
    "p",
    jsx,
  ).document;
  const html = documentToHtml(source, "p");
  const same = await importHtml(html);
  assert.equal(same.stats.restored, 3);
  assert.equal(same.stats.rederived, 0);
  const cls = /class="([^"]*)"[^>]*data-name="Card"|data-name="Card"[^>]*class="([^"]*)"/.exec(
    html,
  );
  const cardClass = (cls[1] || cls[2]).split(/\s+/).at(-1);
  const edited = html.replace(
    new RegExp(`(\\.${cardClass} \\{[^}]*)\\}`),
    `$1  background-color: #fde68a;\n}`,
  );
  assert.notEqual(edited, html);
  const result = await importHtml(edited);
  assert.equal(result.stats.restored, 2);
  assert.equal(result.stats.rederived, 1);
  const card = byName(result.document, "Card");
  assert.equal(card.color, "#fde68a", "the edited declaration wins");
  assert.equal(card.padding, 24, "other declarations of the edited layer are re-derived from CSS");
  assert.equal(card.radius, 12);
  assert.equal(textOf(result.document, "Plan").fontSize, 20);
  // Plain export (no lossless data) goes through the general CSS path and keeps the visual properties.
  const plain = await importHtml(exportHTML(source, "p"));
  const plainCard = byName(plain.document, "Card");
  assert.equal(plainCard.padding, 24);
  assert.equal(plainCard.radius, 12);
  assert.equal(plainCard.color, "#ffffff");
  assert.equal(textOf(plain.document, "Plan").fontSize, 20);
  assert.equal(textOf(plain.document, "Details").color, "#71717b");
});
