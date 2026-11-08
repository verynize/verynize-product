import test from "node:test";
import assert from "node:assert/strict";
import {
  searchIcons,
  resolveIcon,
  iconToNodeImage,
  listIconSets,
  sanitizeSvg,
  isSafeColor,
} from "./assets.mjs";

const decode = (url) => Buffer.from(url.split(",")[1], "base64").toString("utf8");

test("listIconSets reports the bundled sets", () => {
  const sets = listIconSets();
  assert.deepEqual(
    sets.map((s) => s.prefix),
    ["lucide", "ph", "tabler"],
  );
  for (const s of sets) assert.ok(s.total > 1000);
});

test("searchIcons ranks exact names, synonyms and respects set/limit", () => {
  assert.equal(searchIcons("arrow right")[0].name, "lucide:arrow-right");
  assert.equal(searchIcons("close", { set: "lucide" })[0].name, "lucide:x");
  assert.ok(searchIcons("settings", { limit: 5 }).length <= 5);
  assert.ok(searchIcons("search", { set: "ph" }).some((r) => r.name === "ph:magnifying-glass"));
  assert.ok(
    searchIcons("heart", { set: "ph" }).findIndex((r) => r.icon === "heart-fill") > 0,
    "weight variants demoted",
  );
  assert.equal(searchIcons("heart fill", { set: "ph" })[0].icon, "heart-fill");
  assert.deepEqual(searchIcons("  "), []);
  assert.ok(searchIcons("bell", { set: "tabler" }).every((r) => r.set === "tabler"));
});

test("resolveIcon accepts prefixed, kebab and React component names", () => {
  const cases = {
    "lucide:arrow-right": "lucide:arrow-right",
    "ph:arrow-right-bold": "ph:arrow-right-bold",
    "tabler:x": "tabler:x",
    ArrowRight: "lucide:arrow-right",
    ArrowRightIcon: "lucide:arrow-right",
    LuArrowRight: "lucide:arrow-right",
    LucideArrowRight: "lucide:arrow-right",
    Building2: "lucide:building-2",
    TbX: "tabler:x",
    IconBrandGithub: "tabler:brand-github",
    PiHeartFill: "ph:heart-fill",
    "arrow-right": "lucide:arrow-right",
  };
  for (const [input, expected] of Object.entries(cases))
    assert.equal(resolveIcon(input)?.name, expected, input);
  assert.equal(resolveIcon("NotARealIconAtAll"), null);
  assert.equal(resolveIcon("bogus:x"), null);
  assert.equal(resolveIcon("<script>"), null);
  const icon = resolveIcon("lucide:check");
  assert.equal(icon.viewBox, "0 0 24 24");
  assert.equal(icon.width, 24);
  assert.match(
    icon.svg,
    /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]*>.*currentColor.*<\/svg>$/s,
  );
});

test("iconToNodeImage embeds explicit color, size and stroke width", () => {
  const url = iconToNodeImage("ArrowRight", { size: 32, color: "#ff0000", strokeWidth: 1.5 });
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  const svg = decode(url);
  assert.ok(!svg.includes("currentColor"));
  assert.match(svg, /stroke="#ff0000"/);
  assert.match(svg, /stroke-width="1.5"/);
  assert.match(svg, /width="32" height="32"/);
  assert.match(
    decode(iconToNodeImage("ph:house-fill", { color: "rgb(1, 2, 3)" })),
    /fill="rgb\(1, 2, 3\)"/,
  );
  assert.equal(iconToNodeImage("ArrowRight", { color: '"/><script>' }), null);
  assert.equal(iconToNodeImage("nope-nope-nope"), null);
  assert.ok(
    isSafeColor("red") &&
      isSafeColor("#abc") &&
      !isSafeColor("currentColor") &&
      !isSafeColor("url(x)"),
  );
});

test("sanitizeSvg strips active content and external references", () => {
  const dirty = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
    <script>alert(1)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(1)"><rect/></a>
    <image href="https://evil.example/a.png"/><use xlink:href="#ok"/><rect fill="url(#g)" style="fill:url('https://x/y')"/>
    <style>@import url(https://x/y.css);</style><set attributeName="href" to="javascript:x"/></svg>`;
  const clean = sanitizeSvg(dirty);
  assert.match(clean, /^<svg/);
  for (const bad of [
    "onload",
    "<script",
    "foreignObject",
    "javascript:",
    "evil.example",
    "@import",
    "https://x",
    "<set",
    "ENTITY",
  ])
    assert.ok(!clean.includes(bad), bad);
  assert.match(clean, /xlink:href="#ok"/);
  assert.match(clean, /url\(#g\)/);
  assert.equal(sanitizeSvg("<div>no svg</div>"), null);
  assert.equal(sanitizeSvg("<svg>" + "x".repeat(100) + "</svg>", { maxBytes: 50 }), null);
});
