import test from "node:test";
import assert from "node:assert/strict";
import { parseJsx, parseClasses, serializeNode } from "./jsx-codec.mjs";
import {
  createArtboards,
  runDirectives,
  parseDirectives,
  ensureShortIds,
  indexPage,
  elementCode,
  duplicateElements,
} from "./design-edit.mjs";
import { validateDocument } from "./design-store.mjs";
import { NODE_DEFAULTS as NODE_DEFAULTS_FOR_TEST } from "./jsx-codec.mjs";

const blank = () => ({
  version: 2,
  name: "Doc",
  activePage: "p1",
  pages: [{ id: "p1", name: "Page", nodes: [] }],
  tokens: { "color/brand": "#ff0066" },
});
const stripIds = (code) => code.replace(/data-node-id="[^"]*"/g, "");
const CARD = `import { FiStar } from 'react-icons/fi';
<section data-node-label="Pricing card" data-component-x="40" data-component-y="20" className="flex flex-col gap-4 p-6 w-[360px] bg-[#ffffff] rounded-xl shadow-lg overflow-hidden">
  <h2 className="text-[#111111] text-3xl">Pro <b>plan</b></h2>
  <p className="text-[var(--color-brand)] text-[14px] leading-[1.5]">
    Everything you need,
    and <i>more</i>.<br />Billed &amp; yearly.
  </p>
  <div className="grid grid-cols-2 gap-[8px]">
    <div className="h-[40px] bg-[#eeeeee]" />
    <div className="h-[40px] bg-[linear-gradient(90deg,_#ff0000,_#0000ff)]" />
  </div>
  <button className="bg-[#111111] text-white px-4 py-2 rounded-full">Choose</button>
  <img src="data:image/png;base64,aGVsbG8=" className="w-[24px] h-[24px]" />
  <Shader preset="waves" speed={2} intensity={0.5} className="w-[100px] h-[60px]" />
</section>`;

test("JSX parser handles attributes, entities, whitespace, comments and rejects code", () => {
  const { elements, imports } = parseJsx(
    `import X from 'y';\n<div a="1" b={2} c d={'x'}>{/* note */}\n  Hello &amp; <b>world</b>{" !"}\n</div>`,
  );
  assert.equal(imports.length, 1);
  assert.deepEqual(elements[0].attrs, { a: "1", b: 2, c: true, d: "x" });
  assert.equal(elements[0].children[0].text, "Hello & ");
  assert.throws(
    () => parseJsx("<div>{items.map(i => <p>{i}</p>)}</div>"),
    /Only string, number and boolean literals/,
  );
  assert.throws(() => parseJsx("<div><p></div>"), /does not match/);
  assert.throws(() => parseJsx("<div {...props} />"), /Spread/);
});

test("Tailwind classes map to node properties, unknown classes are reported", () => {
  const spec = parseClasses(
    "flex flex-col gap-4 p-[12px] bg-[var(--color-brand)] text-2xl font-semibold rounded-lg opacity-50 hover:bg-black md:p-2 foo-bar",
    { tokens: { "color/brand": "#ff0066" } },
  );
  assert.equal(spec.props.layout, "flex");
  assert.equal(spec.props.direction, "column");
  assert.equal(spec.props.gap, 16);
  assert.equal(spec.props.padding, 12);
  assert.equal(spec.props.fill, "#ff0066");
  assert.equal(spec.props.fillToken, "color/brand");
  assert.equal(spec.props.fontSize, 24);
  assert.equal(spec.props.fontWeight, "600");
  assert.equal(spec.props.radius, 8);
  assert.equal(spec.props.opacity, 50);
  assert.deepEqual(spec.ignored, ["hover:bg-black", "md:p-2", "foo-bar"]);
});

test("create_artboard JSX builds valid nodes and round-trips through get_element_code", () => {
  const { document, roots, warnings, page } = createArtboards(blank(), "p1", CARD);
  validateDocument(document);
  assert.match(warnings.join("\n"), /Import lines were ignored/);
  const root = roots[0];
  assert.equal(root.name, "Pricing card");
  assert.equal(root.x, 40);
  assert.equal(root.y, 20);
  assert.equal(root.w, 360);
  assert.equal(root.layout, "flex");
  assert.equal(root.direction, "column");
  assert.equal(root.clipContent, true);
  assert.equal(root.htmlTag, "section");
  const index = indexPage(page);
  const kids = index.children(root.id);
  assert.deepEqual(
    kids.map((k) => k.type),
    ["text", "text", "frame", "frame", "image", "shader"],
  );
  const heading = kids[0];
  assert.equal(heading.text, "Pro plan");
  assert.deepEqual(heading.textRuns, [{ start: 4, end: 8, bold: true, italic: false }]);
  assert.equal(heading.fontSize, 30);
  assert.equal(kids[1].text, "Everything you need, and more.\nBilled & yearly.");
  assert.equal(kids[1].token, "color/brand");
  assert.equal(kids[1].lineHeight, 1.5);
  assert.equal(kids[2].layout, "grid");
  assert.equal(index.children(kids[2].id)[0].type, "rectangle");
  assert.match(
    index.children(kids[2].id)[1].gradient,
    /^linear-gradient\(90deg, #ff0000, #0000ff\)$/,
  );
  const button = kids[3];
  assert.equal(button.color, "#111111");
  assert.equal(button.radius, 9999);
  assert.equal(index.children(button.id)[0].text, "Choose");
  assert.equal(index.children(button.id)[0].color, "#ffffff");
  assert.equal(kids[4].src, "data:image/png;base64,aGVsbG8=");
  assert.equal(kids[5].shaderPreset, "waves");
  assert.equal(kids[5].shaderSpeed, 2);
  assert.equal(kids[5].shaderIntensity, 0.5);
  // Ids: artboard "abc", descendants "abc.def".
  assert.match(root.shortId, /^[a-z]{3}$/);
  assert.match(index.shortId(heading), new RegExp(`^${root.shortId}\\.[a-z]{3}$`));
  // Round trip: serializing, re-parsing and serializing again is stable.
  const code = elementCode(document, page, root);
  const again = createArtboards(blank(), "p1", code);
  assert.equal(stripIds(elementCode(again.document, again.page, again.roots[0])), stripIds(code));
  assert.match(code, /bg-\[var\(--color-brand\)\]|text-\[var\(--color-brand\)\]/);
});

test("short ids are stable, page-unique and repaired when duplicated", () => {
  const { document } = createArtboards(
    blank(),
    "p1",
    '<div className="w-[10px] h-[10px]"><p>a</p><p>b</p></div>',
  );
  const before = document.pages[0].nodes.map((n) => n.shortId);
  const copy = structuredClone(document);
  for (const n of copy.pages[0].nodes) delete n.shortId;
  ensureShortIds(copy);
  assert.deepEqual(
    copy.pages[0].nodes.map((n) => n.shortId),
    before,
    "derived from node ids deterministically",
  );
  document.pages[0].nodes.push({ ...structuredClone(document.pages[0].nodes[1]), id: "dup" });
  assert.equal(ensureShortIds(document), true);
  assert.equal(
    new Set(document.pages[0].nodes.map((n) => n.shortId)).size,
    document.pages[0].nodes.length,
  );
});

test("directive parser splits scripts and rejects garbage", () => {
  const steps = parseDirectives(
    "{/* edit abc.def */}\n<p>Hi</p>\n{/* insert as last child of abc */}<p/>\n/* delete abc.xyz */\n{/* insert before abc.def */}<p>x</p>",
  );
  assert.deepEqual(
    steps.map((s) => [s.kind, s.target]),
    [
      ["edit", "abc.def"],
      ["last", "abc"],
      ["delete", "abc.xyz"],
      ["before", "abc.def"],
    ],
  );
  assert.equal(steps[0].body, "<p>Hi</p>");
  assert.throws(() => parseDirectives("<p>no directive</p>"), /No directives found/);
  assert.throws(() => parseDirectives("junk {/* edit abc */}<p/>"), /before the first directive/);
});

test("update_elements applies edit/replace/insert/delete independently with a report", () => {
  const created = createArtboards(
    blank(),
    "p1",
    '<div data-node-label="Hero" className="flex flex-col w-[400px] p-[10px]"><h1>Title</h1><p>Body</p><div className="w-[20px] h-[20px] bg-[#000000]" /></div>',
  );
  const index = indexPage(created.page);
  const root = created.roots[0];
  const [title, body, box] = index.children(root.id).map((n) => index.shortId(n));
  const result = runDirectives(
    created.document,
    "p1",
    `
{/* edit ${title} */}
<h1 data-node-label="Headline" className="text-[64px] text-[#ff0000]">New <i>title</i></h1>
{/* replace ${body} */}
<div className="flex gap-2"><p>One</p><p>Two</p></div>
{/* insert as first child of ${root.shortId} */}
<p>Eyebrow</p>
{/* insert after ${title} */}
<p>Subtitle</p>
{/* insert as last child of ${box} */}
<p>inside former rectangle</p>
{/* delete missing.zzz */}
{/* edit ${root.shortId} */}
<div><p>loose child without id</p></div>`,
  );
  assert.equal(result.applied, 5);
  assert.equal(result.failed, 2);
  assert.match(result.report, /OK 1\. edit/);
  assert.match(result.report, /FAIL 6\. delete missing\.zzz: .*not found/);
  assert.match(result.report, /FAIL 7\..*needs data-node-id/);
  assert.match(result.report, /5 of 7 directives applied\. 2 failed\./);
  validateDocument(result.document);
  const page = result.document.pages[0];
  const after = indexPage(page);
  const headline = after.resolve(title);
  assert.equal(headline.name, "Headline");
  assert.equal(headline.fontSize, 64);
  assert.equal(headline.color, "#ff0000");
  assert.equal(headline.text, "New title");
  assert.deepEqual(headline.textRuns, [{ start: 4, end: 9, bold: false, italic: true }]);
  const replaced = after.resolve(body);
  assert.equal(replaced.type, "frame", "replace keeps the id but changes structure");
  assert.equal(after.children(replaced.id).length, 2);
  assert.deepEqual(
    after.children(root.id).map((n) => n.text || n.type),
    ["Eyebrow", "New title", "Subtitle", "frame", "frame"],
  );
  assert.equal(
    after.resolve(box).type,
    "frame",
    "inserting into a rectangle promotes it to a frame",
  );
  // Original document untouched (pure transform).
  assert.equal(indexPage(created.document.pages[0]).resolve(title).text, "Title");
});

test("duplicate_elements copies artboards beside the original with fresh ids", () => {
  const created = createArtboards(
    blank(),
    "p1",
    '<div data-node-label="Card" className="w-[100px] h-[50px]"><p>x</p></div>',
  );
  const out = duplicateElements(created.document, "p1", created.roots[0].shortId, {
    count: 2,
    className: "bg-[#123456]",
  });
  assert.equal(out.created.length, 2);
  assert.equal(out.document.pages[0].nodes.length, 6);
  assert.ok(out.created[0].x >= 180);
  assert.ok(out.created[1].x > out.created[0].x);
  assert.equal(out.created[0].color, "#123456");
  assert.notEqual(out.created[0].shortId, created.roots[0].shortId);
  validateDocument(out.document);
  const index = indexPage(out.document.pages[0]);
  assert.match(serializeNode(out.created[0], index), /data-node-label="Card copy 1"/);
});

// ---------------------------------------------------------------------------------------------
// Stage 1 fidelity fixtures: real Tailwind v4 resolution, flow layout, inheritance, reflow.

const build = (code) => {
  const r = createArtboards(blank(), "p1", code);
  validateDocument(r.document);
  return { ...r, index: indexPage(r.page) };
};
const roundTrip = (code) => {
  const first = build(code);
  const one = stripIds(elementCode(first.document, first.page, first.roots[0]));
  const second = build(one);
  const two = stripIds(elementCode(second.document, second.page, second.roots[0]));
  return { first, second, one, two };
};
const geometry = (page) => page.nodes.map((n) => [n.type, n.x, n.y, n.w, n.h]);

test("Tailwind v4 engine: palette colors, alpha, oklch, and explicit warnings", async () => {
  const { cssColorToHex } = await import("./codec-css.mjs");
  assert.equal(cssColorToHex("oklch(62.8% 0.2577 29.23)"), "#ff0000");
  assert.equal(cssColorToHex("color-mix(in oklab, #000 5%, transparent)"), "#0000000d");
  const spec = parseClasses(
    "bg-white/80 text-gray-500 border-slate-200 foo-bar md:grid-cols-3 hover:bg-black",
  );
  assert.equal(spec.props.fill, "#ffffffcc");
  assert.equal(spec.props.ink, cssColorToHex("oklch(55.1% 0.027 264.364)"));
  assert.match(spec.props.strokeColor, /^#e2e8f0$/);
  assert.deepEqual(spec.ignored, ["foo-bar", "md:grid-cols-3", "hover:bg-black"]);
  assert.match(spec.warnings.join("\n"), /foo-bar: not a Tailwind v4 class/);
  assert.match(spec.warnings.join("\n"), /md:grid-cols-3: variant md: is ignored/);
  const typo = parseClasses(
    "text-5xl/tight leading-7 uppercase underline truncate line-clamp-2 tracking-tight font-mono italic",
  );
  assert.equal(typo.props.fontSize, 48);
  assert.equal(typo.props.lineHeightPx, 28);
  assert.equal(typo.props.textTransform, "uppercase");
  assert.equal(typo.props.textDecoration, "underline");
  assert.equal(typo.props.truncate, true);
  assert.equal(typo.props.lineClamp, 2);
  assert.equal(typo.props.letterSpacingEm, -0.025);
  assert.equal(typo.props.fontFamily, "monospace");
  assert.equal(typo.italic, true);
  const unsupported = parseClasses("divide-y h-screen bg-[url(x.png)]");
  assert.deepEqual(unsupported.ignored, ["divide-y", "h-screen", "bg-[url(x.png)]"]);
});

test("button fixture: per-side padding, full radius, palette fill, text-sm/6 on the label", () => {
  const { roots, index, warnings, document, page } = build(
    '<button className="px-8 py-3 rounded-full bg-slate-900 text-white text-sm/6 font-medium">Get started</button>',
  );
  assert.deepEqual(warnings, []);
  const button = roots[0],
    label = index.children(button.id)[0];
  assert.deepEqual(
    [button.paddingTop, button.paddingRight, button.paddingBottom, button.paddingLeft],
    [12, 32, 12, 32],
  );
  assert.equal(button.radius, 9999);
  assert.match(button.color, /^#0f172[ab]$/);
  assert.equal(button.layout, "flex");
  assert.equal(label.color, "#ffffff");
  assert.equal(label.fontSize, 14);
  assert.equal(label.fontWeight, "500");
  assert.ok(Math.abs(label.lineHeight - 24 / 14) < 0.002);
  assert.equal(button.h, 48, "24px line + py-3");
  assert.equal(button.w, label.w + 64);
  assert.equal(button.wMode, "hug");
  assert.equal(button.hMode, "hug");
  assert.equal(label.measured, false);
  const code = elementCode(document, page, button);
  for (const cls of [
    "px-8",
    "py-3",
    "rounded-full",
    "bg-slate-900",
    "text-white",
    "text-sm/6",
    "font-medium",
  ])
    assert.ok(code.includes(cls), `${cls} in ${code}`);
});

test("card fixture: per-corner radius, shadow scale, ring with alpha", () => {
  const { roots, document, page } = build(
    '<div className="w-[320px] p-6 rounded-t-2xl rounded-b-md shadow-lg ring-1 ring-black/5 bg-white"><p>Card</p></div>',
  );
  const card = roots[0];
  assert.deepEqual(card.cornerRadii, [16, 16, 6, 6]);
  assert.equal(card.padding, 24);
  assert.equal(card.shadow, "0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a");
  assert.equal(card.ringWidth, 1);
  assert.equal(card.ringColor, "#0000000d");
  const code = elementCode(document, page, card);
  assert.match(code, /rounded-t-2xl rounded-b-md/);
  assert.match(code, /shadow-lg/);
  assert.match(code, /ring-1 ring-black\/5/);
  assert.match(code, /p-6/);
});

test("dark hero: text styles declared on ancestors cascade to descendants (CSS inheritance)", () => {
  const { roots, index, document, page } = build(
    `<section className="w-[800px] bg-[#000] text-[#fff] text-sm font-['Geist'] tracking-tight p-10"><h1 className="text-4xl font-semibold">Ship faster</h1><p>Inherited body</p><div><p className="text-zinc-400">Nested muted</p></div></section>`,
  );
  const [h1, body, wrap] = index.children(roots[0].id);
  const nested = index.children(wrap.id)[0];
  for (const t of [h1, body, nested]) {
    assert.equal(t.fontFamily, "Geist");
    assert.ok(t.letterSpacing < 0, "tracking-tight inherited");
  }
  assert.equal(h1.color, "#ffffff");
  assert.equal(h1.fontSize, 36);
  assert.equal(h1.fontWeight, "600");
  assert.equal(body.color, "#ffffff");
  assert.equal(body.fontSize, 14);
  assert.ok(Math.abs(body.lineHeight - 20 / 14) < 0.002);
  assert.notEqual(nested.color, "#ffffff");
  assert.equal(nested.fontSize, 14);
  const code = elementCode(document, page, roots[0]);
  assert.match(code, /bg-black text-white text-sm font-\['Geist'\] tracking-tight/);
  assert.match(
    code,
    /<p data-node-id="[^"]+" data-node-label="Inherited body">/,
    "inherited styles are not repeated on children",
  );
  // Editing the ancestor re-cascades to children that did not declare the property.
  const out = runDirectives(
    document,
    "p1",
    `{/* edit ${roots[0].shortId} */}<section className="text-[#ff0000]" />`,
  );
  const after = indexPage(out.document.pages[0]);
  assert.equal(after.byId.get(body.id).color, "#ff0000");
  assert.equal(after.byId.get(nested.id).color, nested.color, "own color wins");
});

test("block div: padding respected, children stacked and stretched like CSS block flow", () => {
  const { roots, index, document, page, warnings } = build(
    '<div className="w-[400px] p-8"><h1 className="text-2xl">Title</h1><p>Body text long enough to wrap across a couple of lines inside the padded box.</p><div className="h-[10px] bg-[#eeeeee]" /></div>',
  );
  assert.deepEqual(warnings, []);
  const root = roots[0];
  const [h1, p, rule] = index.children(root.id);
  assert.equal(root.layout, "block");
  assert.equal(root.padding, 32);
  assert.equal(root.wMode, "fixed");
  assert.equal(root.hMode, "hug");
  for (const child of [h1, p, rule]) {
    assert.equal(child.x, 32);
    assert.equal(child.w, 336);
    assert.equal(child.wMode, "fill");
  }
  assert.equal(h1.y, 32);
  assert.equal(p.y, h1.y + h1.h);
  assert.equal(rule.y, p.y + p.h);
  assert.ok(p.h > p.fontSize * p.lineHeight * 1.5, "long paragraph wraps");
  assert.equal(root.h, rule.y + rule.h + 32);
  const code = elementCode(document, page, root);
  assert.doesNotMatch(code, /left-\[|top-\[/, "flow children are not serialized as absolute");
  assert.doesNotMatch(
    code.split("\n").slice(1).join("\n"),
    /w-\[336px\]/,
    "fill width is not baked",
  );
});

test("absolute badge inside a flex parent is positioned from its insets, siblings keep flowing", () => {
  const { roots, index, document, page } = build(
    '<div className="relative flex gap-4 p-4 w-[300px] h-[120px]"><p>One</p><p>Two</p><span className="absolute top-2 right-2 rounded-full bg-red-500 px-2 text-xs text-white">New</span></div>',
  );
  const root = roots[0];
  const [one, two, badge] = index.children(root.id);
  assert.equal(badge.position, "absolute");
  assert.deepEqual(badge.inset, [8, 8, null, null]);
  assert.equal(badge.y, 8);
  assert.equal(badge.x, root.w - 8 - badge.w);
  assert.equal(badge.wMode, "hug");
  assert.equal(one.x, 16);
  assert.equal(two.x, one.x + one.w + 16);
  const code = elementCode(document, page, root);
  assert.match(code, /className="absolute top-2 right-2/);
  assert.equal((code.match(/absolute/g) || []).length, 1);
});

test("gap-x/gap-y with flex-wrap wraps items onto lines using the row gap", () => {
  const { roots, index } = build(
    '<div className="flex flex-wrap gap-x-8 gap-y-2 w-[300px]"><div className="w-[100px] h-[20px] bg-[#111111]" /><div className="w-[100px] h-[20px] bg-[#111111]" /><div className="w-[100px] h-[20px] bg-[#111111]" /></div>',
  );
  const root = roots[0];
  const items = index.children(root.id);
  assert.equal(root.gapX, 32);
  assert.equal(root.gapY, 8);
  assert.equal(root.flexWrap, true);
  assert.deepEqual(
    items.map((i) => [i.x, i.y]),
    [
      [0, 0],
      [132, 0],
      [0, 28],
    ],
  );
  assert.equal(root.h, 48);
});

test("responsive variants produce an explicit warning instead of a silent drop", () => {
  const { warnings, roots } = build(
    '<div className="grid grid-cols-1 md:grid-cols-3 w-[600px]"><p>a</p></div>',
  );
  assert.equal(roots[0].columns, 1);
  assert.match(warnings.join("\n"), /md:grid-cols-3: variant md: is ignored/);
  const invalid = build('<div className="w-[100px] foo-bar"><p>x</p></div>');
  assert.match(invalid.warnings.join("\n"), /foo-bar: not a Tailwind v4 class/);
});

test("editing text to a long paragraph reflows siblings and the parent (no overlap)", () => {
  const created = build(
    '<div className="flex flex-col gap-2 p-4 w-[240px] bg-white"><p>A</p><p>B</p><div className="h-[20px] bg-[#000000]" /></div>',
  );
  const root = created.roots[0];
  const [a, b] = created.index.children(root.id);
  const out = runDirectives(
    created.document,
    "p1",
    `{/* edit ${created.index.shortId(a)} */}<p>${"A long paragraph of text that will wrap over many lines. ".repeat(6)}</p>`,
  );
  assert.equal(out.applied, 1);
  validateDocument(out.document);
  const index = indexPage(out.document.pages[0]);
  const [a2, b2, box] = index.children(root.id);
  const parent = index.byId.get(root.id);
  assert.ok(a2.h > 100, `paragraph grew (${a2.h})`);
  assert.equal(a2.w, 208, "width stays the fill width");
  assert.equal(b2.y, a2.y + a2.h + 8);
  assert.equal(box.y, b2.y + b2.h + 8);
  assert.equal(parent.h, box.y + box.h + 16, "hug parent grew");
  assert.equal(a2.measured, false, "geometry provenance: headless estimate");
  void b;
});

test("round trip: parse -> serialize -> parse is stable for flow layouts", () => {
  const code = `<main data-node-label="Landing" className="w-[1200px] bg-white text-slate-900 font-sans">
    <header className="flex items-center justify-between px-10 py-4 border-b border-slate-200"><span className="text-lg font-semibold tracking-tight">Acme</span><nav className="flex gap-6 text-sm text-slate-600"><a>Docs</a><a>Pricing</a></nav><button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Sign in</button></header>
    <section className="mx-auto max-w-3xl px-6 py-24 text-center"><h1 className="text-5xl/tight font-bold text-balance">Design at the speed of thought</h1><p className="mt-6 text-lg/8 text-slate-600">Agents write Tailwind; the canvas keeps the flow.</p></section>
    <section className="grid grid-cols-3 gap-6 px-10 pb-16"><div className="relative rounded-2xl p-6 ring-1 ring-black/5 shadow-sm"><h3 className="font-semibold">Fast</h3><p className="text-sm/6 text-slate-500 line-clamp-2">Short copy.</p><span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2 text-xs">Hot</span></div><div className="col-span-2 flex flex-col gap-y-3 rounded-2xl bg-linear-to-r from-sky-500 to-indigo-500 p-6 text-white"><p className="uppercase text-xs tracking-widest">Feature</p><p className="flex-1">Grow</p></div></section>
  </main>`;
  const { first, second, one, two } = roundTrip(code);
  assert.equal(two, one);
  assert.deepEqual(geometry(second.page), geometry(first.page));
  assert.doesNotMatch(one, /left-\[\d|top-\[\d/, "no baked absolute positions");
  for (const cls of [
    "justify-between",
    "px-10",
    "border-b border-slate-200",
    "mx-auto",
    "max-w-3xl",
    "grid grid-cols-3 gap-6",
    "col-span-2",
    "ring-1 ring-black/5",
    "absolute -top-2 left-1/2 -translate-x-1/2",
    "text-5xl/tight",
    "uppercase",
    "tracking-widest",
    "line-clamp-2",
    "linear-gradient",
  ])
    assert.ok(one.includes(cls), `${cls} in\n${one}`);
  const hero = first.index.children(first.roots[0].id)[1];
  assert.equal(hero.maxW, 768);
  assert.deepEqual(hero.margin, [0, "auto", 0, "auto"]);
  assert.equal(hero.x, (1200 - hero.w) / 2);
});

test("legacy documents: numeric padding and free frames still read, render and serialize", () => {
  const doc = blank();
  doc.pages[0].nodes = [
    {
      ...structuredClone(NODE_DEFAULTS_FOR_TEST),
      id: "r",
      type: "frame",
      name: "Old",
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      layout: "free",
      color: "#ffffff",
    },
    {
      ...structuredClone(NODE_DEFAULTS_FOR_TEST),
      id: "t",
      type: "text",
      name: "T",
      parentId: "r",
      x: 12,
      y: 40,
      w: 100,
      h: 20,
      text: "Hi",
      color: "#111111",
    },
    {
      ...structuredClone(NODE_DEFAULTS_FOR_TEST),
      id: "f",
      type: "frame",
      name: "Stack",
      parentId: "r",
      x: 0,
      y: 100,
      w: 200,
      h: 80,
      layout: "flex",
      padding: 10,
      gap: 6,
      color: "transparent",
    },
  ];
  ensureShortIds(doc);
  const page = doc.pages[0];
  const code = elementCode(doc, page, page.nodes[0]);
  assert.match(code, /absolute left-\[12px\] top-\[40px\]/);
  assert.match(code, /layout-free/);
  assert.match(code, /flex gap-1\.5 p-2\.5/);
  const again = build(code);
  const kids = again.index.children(again.roots[0].id);
  assert.equal(again.roots[0].layout, "free");
  assert.deepEqual([kids[0].x, kids[0].y], [12, 40]);
  assert.equal(kids[1].padding, 10);
  assert.equal(kids[1].gap, 6);
});

test("icon components become image nodes with generated SVG, inherited color and round-trip as <Icon>", () => {
  const svg = (n) => Buffer.from(n.src.split(",")[1], "base64").toString();
  const { document, page, roots, warnings } = createArtboards(
    blank(),
    "p1",
    `<div data-component-x="0" data-component-y="0" className="flex items-center gap-2 p-4 w-[320px] text-white bg-black">
    <Icon name="lucide:arrow-right" className="size-5 text-slate-500" />
    <ArrowRight className="size-4" />
    <LuX strokeWidth={1.5} />
    <IconBrandGithub size={32} />
    <Icon name="lucide:definitely-not-an-icon" />
  </div>`,
  );
  validateDocument(document);
  const [own, inherited, lu, tabler, missing] = indexPage(page).children(roots[0].id);
  assert.equal(own.type, "image");
  assert.equal(own.icon, "lucide:arrow-right");
  assert.equal(own.w, 20);
  assert.equal(own.h, 20);
  assert.equal(own.assetStatus, "ready");
  assert.match(own.src, /^data:image\/svg\+xml;base64,/);
  assert.match(svg(own), /stroke="#62748e"/);
  assert.equal(inherited.w, 16);
  assert.match(svg(inherited), /stroke="#ffffff"/, "icon without a color inherits the text color");
  assert.equal(lu.icon, "lucide:x");
  assert.equal(lu.w, 24);
  assert.equal(lu.iconStrokeWidth, 1.5);
  assert.match(svg(lu), /stroke-width="1.5"/);
  assert.equal(tabler.icon, "tabler:brand-github");
  assert.equal(tabler.w, 32);
  assert.equal(missing.assetStatus, "missing");
  assert.equal(missing.src, undefined);
  assert.ok(warnings.some((w) => /definitely-not-an-icon.*not found/.test(w)));
  const code = elementCode(document, page, roots[0]);
  assert.match(
    code,
    /<Icon data-node-id="[^"]+" data-node-label="arrow-right" name="lucide:arrow-right" className="size-5 text-slate-500" \/>/,
  );
  assert.match(code, /name="lucide:x" strokeWidth=\{1.5\} className="size-6"/);
  const again = createArtboards(blank(), "p1", code);
  assert.equal(stripIds(elementCode(again.document, again.page, again.roots[0])), stripIds(code));
  // Recoloring an ancestor regenerates inherited icons; icons with their own color keep it.
  const ref = indexPage(page).shortId(roots[0]);
  const edited = runDirectives(
    document,
    "p1",
    `{/* edit ${ref} */}<div className="text-red-500" />`,
  );
  assert.equal(edited.failed, 0);
  const after = new Map(edited.document.pages[0].nodes.map((n) => [n.id, n]));
  assert.match(svg(after.get(inherited.id)), /stroke="#fb2c36"/);
  assert.match(svg(after.get(own.id)), /stroke="#62748e"/);
  const recolor = runDirectives(
    edited.document,
    "p1",
    `{/* edit ${indexPage(edited.document.pages[0]).shortId(after.get(own.id))} */}<Icon name="lucide:check" className="text-[#00ff00]" />`,
  );
  const own2 = recolor.document.pages[0].nodes.find((n) => n.id === own.id);
  assert.equal(own2.icon, "lucide:check");
  assert.match(svg(own2), /stroke="#00ff00"/);
});

test("remote <img> keeps its URL as srcRemote with a pending asset status", () => {
  const { document, page, roots, warnings } = createArtboards(
    blank(),
    "p1",
    `<div data-component-x="0" data-component-y="0" className="w-[300px]"><img src="https://images.example.com/hero.jpg" className="w-full h-[160px] object-cover" /></div>`,
  );
  validateDocument(document);
  const img = indexPage(page).children(roots[0].id)[0];
  assert.equal(img.srcRemote, "https://images.example.com/hero.jpg");
  assert.equal(img.assetStatus, "pending");
  assert.equal(img.src, undefined);
  assert.ok(!warnings.some((w) => /src must be/.test(w)));
  assert.match(
    elementCode(document, page, roots[0]),
    /<img [^>]*src="https:\/\/images\.example\.com\/hero\.jpg"/,
  );
  // Once the tool layer embeds the asset, the embedded data is serialized and survives an unchanged edit.
  img.src = "data:image/png;base64,aGVsbG8=";
  img.assetStatus = "ready";
  const ref = indexPage(page).shortId(img);
  const same = runDirectives(
    document,
    "p1",
    `{/* edit ${ref} */}<img src="https://images.example.com/hero.jpg" />`,
  );
  assert.equal(
    same.document.pages[0].nodes.find((n) => n.id === img.id).src,
    "data:image/png;base64,aGVsbG8=",
  );
  const changed = runDirectives(
    document,
    "p1",
    `{/* edit ${ref} */}<img src="https://images.example.com/other.jpg" />`,
  );
  const next = changed.document.pages[0].nodes.find((n) => n.id === img.id);
  assert.equal(next.srcRemote, "https://images.example.com/other.jpg");
  assert.equal(next.assetStatus, "pending");
  assert.equal(next.src, undefined);
});

test("reversed flex, grid rows, cell alignment and row spans round-trip and lay out", () => {
  const JSX = `<div data-node-label="Board" data-component-x="0" data-component-y="0" className="flex flex-col gap-0 w-[400px]">
  <div className="flex flex-row-reverse gap-[10px] w-[300px] h-[50px]">
    <div className="w-[50px] h-[50px] bg-[#ff0000]" />
    <div className="w-[50px] h-[50px] bg-[#00ff00]" />
  </div>
  <div className="grid grid-cols-2 grid-rows-2 justify-items-center items-end gap-[0px] w-[200px] h-[200px]">
    <div className="w-[40px] h-[40px] bg-[#0000ff]" />
    <div className="row-span-2 w-[40px] h-[40px] bg-[#ffff00]" />
  </div>
</div>`;
  const { document, roots, warnings, page } = createArtboards(blank(), "p1", JSX);
  validateDocument(document);
  assert.doesNotMatch(warnings.join("\n"), /reverse|grid-template-rows|grid-row|justify-items/);
  const index = indexPage(page),
    [row, grid] = index.children(roots[0].id),
    [a, b] = index.children(row.id),
    [cell, tall] = index.children(grid.id);
  assert.equal(row.reverse, true);
  assert.equal(row.direction, "row");
  assert.deepEqual(
    [grid.rows, grid.justifyItems, grid.alignItems, tall.rowSpan],
    [2, "center", "flex-end", 2],
  );
  // row-reverse mirrors the forward layout: the first child sits at the right edge.
  assert.deepEqual([a.x, b.x], [250, 190]);
  // Cell alignment: centered in its 100px column, at the bottom of the first 100px row.
  assert.deepEqual([cell.x, cell.y], [30, 60]);
  const code = stripIds(elementCode(document, page, roots[0]));
  assert.match(code, /flex-row-reverse/);
  assert.match(code, /grid-rows-2/);
  assert.match(code, /justify-items-center/);
  assert.match(code, /row-span-2/);
});

test("constraints in free frames round-trip as insets and lay out", async () => {
  const { constraintsOf } = await import("./node-style.mjs");
  const JSX = `<div data-node-label="Board" data-component-x="0" data-component-y="0" className="layout-free w-[400px] h-[300px]">
  <div className="absolute right-[16px] top-[20px] w-[80px] h-[40px] bg-[#ff0000]" />
  <div className="absolute left-1/2 -translate-x-1/2 top-[10px] w-[100px] h-[20px] bg-[#00ff00]" />
  <div className="absolute left-[10px] right-[10px] bottom-[0px] h-[30px] bg-[#0000ff]" />
  <div className="absolute left-[25%] top-[50%] w-[50%] h-[10px] bg-[#ffff00]" />
  <div className="absolute left-[5px] top-[6px] w-[10px] h-[10px] bg-[#00ffff]" />
</div>`;
  const { document, roots, warnings, page } = createArtboards(blank(), "p1", JSX);
  validateDocument(document);
  assert.doesNotMatch(warnings.join("\n"), /approximated/);
  const index = indexPage(page),
    [right, center, stretch, scale, plain] = index.children(roots[0].id);
  assert.deepEqual(
    [right, center, stretch, scale, plain].map((n) => constraintsOf(n)),
    [
      { h: "end", v: "start" },
      { h: "center", v: "start" },
      { h: "stretch", v: "end" },
      { h: "scale", v: "scale" },
      { h: "start", v: "start" },
    ],
  );
  assert.equal(plain.inset, undefined, "plain left/top stays x/y");
  assert.deepEqual([plain.x, plain.y], [5, 6]);
  assert.deepEqual(
    [right.x, right.y],
    [304, 20],
    "right-pinned layers lay out from the right edge",
  );
  assert.deepEqual([center.x, stretch.x, stretch.w, stretch.y], [150, 10, 380, 270]);
  assert.deepEqual([scale.x, scale.y, scale.w], [100, 150, 200]);
  const code = stripIds(elementCode(document, page, roots[0]));
  assert.match(code, /right-4/);
  assert.match(code, /left-1\/2/);
  assert.match(code, /-translate-x-1\/2/);
  assert.match(
    code,
    /right-2\.5 bottom-0 left-2\.5 h-\[30px\]/,
    "Left & Right exports both insets and no width",
  );
  assert.match(code, /left-1\/4/);
  const again = createArtboards(blank(), "p1", code),
    [r2, c2, s2, sc2, p2] = indexPage(again.page).children(again.roots[0].id);
  assert.deepEqual(
    [r2, c2, s2, sc2, p2].map((n) => constraintsOf(n)),
    [right, center, stretch, scale, plain].map((n) => constraintsOf(n)),
    "constraints survive export and import",
  );
});
