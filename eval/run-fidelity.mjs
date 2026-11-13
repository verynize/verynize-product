#!/usr/bin/env node
// Tier 1: deterministic codec fidelity. Each fixture is eval/fidelity/fixtures/<id>.jsx + <id>.json.
// Model assertions read the document produced by the codec; "rendered" assertions export HTML and
// measure it in headless Chrome (skipped, not passed, when no browser is available).
//
//   node eval/run-fidelity.mjs [--filter <substr>] [--verbose] [--no-render] [--json <out.json>]
//
// Exit code: 0 when every fixture passes, 1 otherwise.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./lib/adapter.mjs";
import { measure, closeBrowser, browser } from "./lib/render.mjs";
import { sameColor, formatColor, parseColor } from "./lib/color.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const filter = opt("--filter"),
  verbose = flag("--verbose"),
  noRender = flag("--no-render"),
  jsonOut = opt("--json");

const dir = join(here, "fidelity/fixtures");
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    // Source: NN-name.jsx (codec JSX) or NN-name.html (HTML + CSS through the HTML importer).
    const html = join(dir, f.replace(/\.json$/, ".html"));
    return {
      id: f.replace(/\.json$/, ""),
      ...JSON.parse(readFileSync(join(dir, f), "utf8")),
      ...(existsSync(html)
        ? { html: readFileSync(html, "utf8") }
        : { jsx: readFileSync(join(dir, f.replace(/\.json$/, ".jsx")), "utf8") }),
    };
  })
  .filter((f) => !filter || f.id.includes(filter));

// ---------------------------------------------------------------------------------------------
const TOL = 0.5;
const fmt = (v) => (typeof v === "object" ? JSON.stringify(v) : String(v));
function close(actual, expected, tol) {
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected).every(([k, v]) => close(actual[k], v, tol));
  }
  if (typeof expected === "number")
    return typeof actual === "number" && Math.abs(actual - expected) <= tol;
  return actual === expected;
}
function colorsIn(text) {
  const s = String(text || "");
  const found = s.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)/gi) || [];
  for (const m of s.matchAll(/var\(--color-([a-z]+-\d{2,3})\)/gi)) found.push(`tw:${m[1]}`);
  return found;
}
function layers(text) {
  let depth = 0,
    count = String(text || "").trim() ? 1 : 0;
  for (const c of String(text || "")) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) count++;
  }
  return count;
}
const mentions = (warnings, cls) => {
  const esc = cls.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`(^|[\\s:,'"\`(])${esc}($|[\\s,'"\`);:.…])`);
  return warnings.some((w) => re.test(w));
};
const isColorProp = (p) => ["fill", "ink", "strokeColor", "color", "background"].includes(p);

function checkValue(actual, a, label) {
  if ("color" in a) {
    const value = actual === undefined || actual === null || actual === "" ? "transparent" : actual;
    return sameColor(value, a.color)
      ? null
      : `${label} = ${formatColor(value)} (raw ${fmt(actual)}), expected ${formatColor(a.color)}`;
  }
  if ("colors" in a) {
    const found = colorsIn(actual);
    const missing = a.colors.filter((e) => !found.some((f) => sameColor(f, e)));
    return missing.length
      ? `${label} = ${fmt(actual)}; missing colors ${missing.join(", ")}`
      : null;
  }
  if ("layers" in a)
    return layers(actual) >= a.layers
      ? null
      : `${label} has ${layers(actual)} layer(s) (${fmt(actual)}), expected >= ${a.layers}`;
  if ("matches" in a)
    return new RegExp(a.matches, "i").test(String(actual ?? ""))
      ? null
      : `${label} = ${fmt(actual)}, expected /${a.matches}/`;
  if ("max" in a && !(actual <= a.max + (a.tol ?? TOL)))
    return `${label} = ${fmt(actual)}, expected <= ${a.max}`;
  if ("min" in a && !(actual >= a.min - (a.tol ?? TOL)))
    return `${label} = ${fmt(actual)}, expected >= ${a.min}`;
  if ("eq" in a && !close(actual, a.eq, a.tol ?? TOL))
    return `${label} = ${fmt(actual)}, expected ${fmt(a.eq)}`;
  return null;
}

function rel(child, parent) {
  return {
    x: child.x - parent.x,
    y: child.y - parent.y,
    left: child.x - parent.x,
    top: child.y - parent.y,
    right: parent.x + parent.w - (child.x + child.w),
    bottom: parent.y + parent.h - (child.y + child.h),
    w: child.w,
    h: child.h,
  };
}
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

async function runFixture(fx) {
  const results = [];
  const record = (a, error, skipped = false) =>
    results.push({ assertion: a, ok: !error && !skipped, skipped, error });
  let state;
  try {
    state =
      fx.html !== undefined
        ? await A.buildHtml(fx.html, fx.viewport)
        : await A.build(fx.jsx, fx.viewport);
    for (const step of fx.edits || []) state = await A.edit(state, step);
    await A.validate(state);
  } catch (error) {
    return { status: "ERROR", results, error: error.message };
  }

  let code1 = null,
    codeError = null;
  if (fx.roundTrip || fx.expect.some((a) => a.serializedNot)) {
    try {
      code1 = await A.serialize(state);
    } catch (e) {
      codeError = e.message;
    }
  }
  let facts = null,
    renderError = null;
  const needsRender = fx.expect.some((a) => a.rendered || a.noOverlap);
  if (needsRender && !noRender) {
    try {
      const html = await A.toHtml(state);
      facts = await measure(html, { width: 1600, height: 1200 });
      if (!facts) renderError = "no Chromium available";
    } catch (e) {
      renderError = `render failed: ${e.message}`;
    }
  }
  const rect = (name) => facts?.[name]?.[0];
  const node = (name) => A.findByLabel(state, name)[0];

  for (const a of fx.expect) {
    if (a.warns) {
      const missing = a.warns.filter((c) => !mentions(state.warnings, c));
      record(
        a,
        missing.length
          ? `no warning for ${missing.join(", ")} (warnings: ${fmt(state.warnings)})`
          : null,
      );
      continue;
    }
    if (a.noWarnAbout) {
      const hit = a.noWarnAbout.filter((c) => mentions(state.warnings, c));
      record(a, hit.length ? `supported class reported as ignored: ${hit.join(", ")}` : null);
      continue;
    }
    if (a.serializedNot) {
      record(
        a,
        codeError
          ? `serialize failed: ${codeError}`
          : new RegExp(a.serializedNot).test(code1)
            ? `serialized code matches /${a.serializedNot}/:\n${code1
                .split("\n")
                .filter((l) => new RegExp(a.serializedNot).test(l))
                .slice(0, 3)
                .join("\n")}`
            : null,
      );
      continue;
    }
    if (a.rendered || a.noOverlap) {
      if (noRender || renderError === "no Chromium available") {
        record(a, null, true);
        continue;
      }
      if (renderError) {
        record(a, renderError);
        continue;
      }
      if (a.noOverlap) {
        const parent = node(a.noOverlap);
        if (!parent) {
          record(a, `node "${a.noOverlap}" not found`);
          continue;
        }
        const kids = A.childrenOf(state, parent)
          .filter((k) => A.positioning(k) !== "absolute")
          .map((k) => ({ name: k.name, r: rect(k.name) }))
          .filter((k) => k.r);
        const bad = [];
        for (let i = 0; i < kids.length; i++)
          for (let j = i + 1; j < kids.length; j++)
            if (overlap(kids[i].r, kids[j].r) > 1) bad.push(`${kids[i].name} x ${kids[j].name}`);
        const p = rect(a.noOverlap);
        const escaped = p
          ? kids
              .filter((k) => k.r.y + k.r.h > p.y + p.h + 1 || k.r.x + k.r.w > p.x + p.w + 1)
              .map((k) => k.name)
          : [];
        record(
          a,
          bad.length || escaped.length
            ? [
                bad.length && `overlaps: ${bad.join(", ")}`,
                escaped.length && `outside parent: ${escaped.join(", ")}`,
              ]
                .filter(Boolean)
                .join("; ")
            : null,
        );
        continue;
      }
      const r = rect(a.rendered);
      if (!r) {
        record(a, `rendered element "${a.rendered}" not found`);
        continue;
      }
      const tol = a.tol ?? 1;
      if (a.relTo) {
        const p = rect(a.relTo);
        if (!p) {
          record(a, `rendered "${a.relTo}" not found`);
          continue;
        }
        record(a, checkValue(rel(r, p), { eq: a.eq, tol }, `${a.rendered} rel ${a.relTo}`));
        continue;
      }
      if (a.below) {
        const b = rect(a.below);
        if (!b) {
          record(a, `rendered "${a.below}" not found`);
          continue;
        }
        const g = r.y - (b.y + b.h);
        record(
          a,
          Math.abs(g - a.gap) <= tol
            ? null
            : `${a.rendered} starts ${g.toFixed(1)}px below ${a.below}, expected ${a.gap}`,
        );
        continue;
      }
      if (a.inside) {
        const p = rect(a.inside);
        if (!p) {
          record(a, `rendered "${a.inside}" not found`);
          continue;
        }
        const d = rel(r, p),
          inset = a.inset ?? 0;
        const off = ["left", "top", "right", "bottom"].filter((k) => d[k] < inset - tol);
        record(
          a,
          off.length
            ? `${a.rendered} escapes ${a.inside} inset ${inset} on ${off.map((k) => `${k} (${d[k].toFixed(1)})`).join(", ")}`
            : null,
        );
        continue;
      }
      if (a.prop) {
        record(a, checkValue(r[a.prop], { ...a, tol }, `rendered ${a.rendered}.${a.prop}`));
        continue;
      }
      record(a, "unknown rendered assertion");
      continue;
    }
    if (a.node) {
      const n = node(a.node);
      if (!n) {
        record(
          a,
          `node "${a.node}" not found (labels: ${A.nodes(state)
            .map((x) => x.name)
            .slice(0, 20)
            .join(", ")})`,
        );
        continue;
      }
      const get = A.ACCESSORS[a.prop];
      if (!get) {
        record(a, `unknown prop ${a.prop}`);
        continue;
      }
      record(
        a,
        checkValue(
          get(n),
          isColorProp(a.prop) && "eq" in a ? { color: a.eq } : a,
          `${a.node}.${a.prop}`,
        ),
      );
      continue;
    }
    record(a, "unknown assertion");
  }

  if (fx.roundTrip) {
    const a = { roundTrip: true };
    try {
      if (codeError) throw new Error(`serialize failed: ${codeError}`);
      const strip = (c) => String(c).replace(/\s*data-node-id="[^"]*"/g, "");
      // The document's variables travel with the code (as they do in the editor and in exports).
      const state2 = await A.build(code1, fx.viewport, {
        tokens: state.doc.tokens,
        variables: state.doc.variables,
      });
      const code2 = await A.serialize(state2);
      const diffs = [];
      if (strip(code1) !== strip(code2))
        diffs.push("serialize(parse(serialize(x))) differs from serialize(x)");
      const props = [
        "padding",
        "radius",
        "gap",
        "fill",
        "ink",
        "sizing",
        "layout",
        "direction",
        "fontSize",
        "lineHeightPx",
        "fontWeight",
        "letterSpacingPx",
        "shadow",
        "gradient",
      ];
      // Pair nodes by label and occurrence (several nodes may share a label, e.g. "Label").
      const seen = new Map();
      for (const n1 of A.nodes(state).filter((n) => n.name)) {
        const k = seen.get(n1.name) || 0;
        seen.set(n1.name, k + 1);
        const n2 = A.findByLabel(state2, n1.name)[k];
        if (!n2) {
          diffs.push(`"${n1.name}" lost`);
          continue;
        }
        for (const p of props) {
          const v1 = A.ACCESSORS[p](n1),
            v2 = A.ACCESSORS[p](n2);
          const same = isColorProp(p)
            ? (v1 == null && v2 == null) || sameColor(v1 ?? "transparent", v2 ?? "transparent")
            : JSON.stringify(v1) === JSON.stringify(v2);
          if (!same) diffs.push(`${n1.name}.${p}: ${fmt(v1)} -> ${fmt(v2)}`);
        }
      }
      record(
        a,
        diffs.length
          ? diffs.slice(0, 6).join("; ") + (diffs.length > 6 ? ` (+${diffs.length - 6} more)` : "")
          : null,
      );
    } catch (e) {
      record(a, e.message);
    }
  }
  const failed = results.filter((r) => !r.ok && !r.skipped).length;
  return { status: failed ? "FAIL" : "PASS", results, warnings: state.warnings };
}

// ---------------------------------------------------------------------------------------------
const describe = (a) =>
  a.roundTrip
    ? "round-trip"
    : a.warns
      ? `warns ${a.warns.join(" ")}`
      : a.noWarnAbout
        ? `no warning for ${a.noWarnAbout.join(" ")}`
        : a.serializedNot
          ? `serialized !~ /${a.serializedNot}/`
          : a.noOverlap
            ? `no overlap in ${a.noOverlap}`
            : a.rendered
              ? `rendered ${a.rendered}${a.relTo ? " rel " + a.relTo : a.below ? " below " + a.below : a.inside ? " inside " + a.inside : "." + a.prop}`
              : `${a.node}.${a.prop}`;

const rows = [];
if (!noRender && !(await browser()))
  console.warn(
    "! No Chromium found; rendered assertions will be SKIPPED (install Google Chrome or `npx playwright install chromium`).",
  );
for (const fx of fixtures) {
  const out = await runFixture(fx);
  const passed = out.results.filter((r) => r.ok).length,
    skipped = out.results.filter((r) => r.skipped).length,
    total = out.results.length;
  const firstFail = out.error || out.results.find((r) => !r.ok && !r.skipped)?.error || "";
  rows.push({
    id: fx.id,
    title: fx.title,
    covers: fx.covers,
    status: out.status,
    passed,
    skipped,
    total,
    firstFail,
    results: out.results.map((r) => ({
      check: describe(r.assertion),
      ok: r.ok,
      skipped: r.skipped,
      error: r.error,
    })),
    warnings: out.warnings,
  });
}
await closeBrowser();

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${pad("fixture", 30)} ${pad("status", 6)} ${pad("checks", 8)} first failure`);
console.log("-".repeat(110));
for (const r of rows) {
  console.log(
    `${pad(r.id, 30)} ${pad(r.status, 6)} ${pad(`${r.passed}/${r.total}${r.skipped ? ` s${r.skipped}` : ""}`, 8)} ${String(r.firstFail).split("\n")[0].slice(0, 120)}`,
  );
  if (verbose)
    for (const c of r.results.filter((c) => !c.ok))
      console.log(`    ${c.skipped ? "SKIP" : "FAIL"} ${c.check}${c.error ? ": " + c.error : ""}`);
}
const count = (s) => rows.filter((r) => r.status === s).length;
const checks = rows.reduce((s, r) => s + r.total, 0),
  okChecks = rows.reduce((s, r) => s + r.passed, 0),
  skipChecks = rows.reduce((s, r) => s + r.skipped, 0);
console.log("-".repeat(110));
console.log(
  `fixtures: ${count("PASS")} pass, ${count("FAIL")} fail, ${count("ERROR")} error of ${rows.length}; checks: ${okChecks}/${checks} pass${skipChecks ? `, ${skipChecks} skipped` : ""}`,
);
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify({ date: new Date().toISOString(), rows }, null, 2));
}
process.exitCode = count("PASS") === rows.length ? 0 : 1;
void parseColor;
