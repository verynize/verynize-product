const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { synthetic } = require("../eval/canvas-perf/bench-verynize.cjs");
const install = require("../eval/canvas-perf/renderer.cjs");
const { checkSource } = require("../scripts/check-css-has.cjs");

(async () => {
  for (const variant of [
    "focus",
    "focus-visible",
    "focus-within",
    "hover",
    "active",
    "checked",
    "disabled",
  ]) {
    for (const prefix of ["has-", "group-has-", "peer-has-"]) {
      assert.equal(checkSource(`${prefix}${variant}/named:opacity-0`).length, 1);
      assert.equal(checkSource(`${prefix}[:${variant}]:opacity-0`).length, 1);
    }
  }
  assert.equal(
    checkSource("group-focus-within/chip:opacity-0 has-[>svg]:px-2 has-data-[slot=action]:flex")
      .length,
    0,
  );
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-css-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(() => window.fileLibrary.showEditor());
    await page.evaluate(install);
    await page.evaluate((doc) => __perf.action("load", doc), synthetic(500));
    const result = await page.evaluate(() => {
      const offenders = [],
        anchored = [];
      let selectors = 0;
      const canvas = document.querySelector("#canvas");
      // Top-level parts of a selector list (commas inside parentheses, brackets or quotes stay).
      const parts = (text) => {
        const out = [];
        let depth = 0,
          quote = "",
          start = 0;
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = "";
          } else if (c === '"' || c === "'") quote = c;
          else if (c === "(" || c === "[") depth++;
          else if (c === ")" || c === "]") depth--;
          else if (c === "," && !depth) {
            out.push(text.slice(start, i));
            start = i + 1;
          }
        }
        return [...out, text.slice(start)].map((p) => p.trim());
      };
      // A `X:has(…)` rule whose X is #canvas or one of its ancestors is re-checked for every DOM change inside the
      // canvas, and Blink then walks X's whole subtree (every layer) to find what it styles: O(page) per mutation,
      // several mutations per pointer move. The part of the selector before `:has(` (minus any enclosing `:not(`,
      // `:is(`…) selects X.
      const anchoredHas = (selector) => {
        for (let i = selector.indexOf(":has("); i >= 0; i = selector.indexOf(":has(", i + 1)) {
          let prefix = selector.slice(0, i);
          for (;;) {
            let depth = 0,
              open = -1;
            for (let j = prefix.length - 1; j >= 0 && open < 0; j--) {
              if (prefix[j] === ")") depth++;
              else if (prefix[j] === "(" && !depth--) open = j;
            }
            if (open < 0) break;
            // Inside `:is(…, Y` / `:where(…, Y` the subject also matches Y; other functions keep the outer compound.
            const name = prefix.lastIndexOf(":", open),
              list = /^:(is|where)$/.test(prefix.slice(name, open));
            prefix = prefix.slice(0, name) + (list ? parts(prefix.slice(open + 1)).at(-1) : "");
          }
          try {
            if (canvas.closest(/[\s>+~]$/.test(prefix) || !prefix.trim() ? `${prefix} *` : prefix))
              return true;
          } catch {
            return true; // unreadable: flag it rather than skip it
          }
        }
        return false;
      };
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.selectorText) {
            selectors++;
            if (/:has\(\s*:focus/.test(rule.selectorText)) offenders.push(rule.selectorText);
            for (const selector of parts(rule.selectorText))
              if (selector.includes(":has(") && anchoredHas(selector)) anchored.push(selector);
          }
          if (rule.cssRules) walk(rule.cssRules);
          if (rule.styleSheet) walk(rule.styleSheet.cssRules);
        }
      };
      // Fail on unreadable sheets too: silently skipping one would weaken this regression gate.
      for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets])
        walk(sheet.cssRules);
      // The detector itself: the rules this gate replaced, and allowed rules of the same shape.
      const detects = [
        "#workspace:has(.canvas-preview.selected) #selection-name",
        "#canvas-wrap:has(#canvas .layer[data-text-editing]) #canvas-overlay .clipped-selection",
        ":has(.layer) .x",
        "body :not(:has(#canvas)) .x",
        ":is(.a, #canvas-wrap:has(.b)) .x",
      ].map(anchoredHas);
      const allows = [
        ".project-agent > div:has(#project-run)",
        '#canvas .layer[data-component="instance-slot"]:not(:has(> .layer))::before',
        "#inspector:not([data-kind=text]) label:has([name=lineHeight])",
        ":is(html #cloud-dialog [hidden], html #cloud-dialog .cloud-actions:not(:has(> :not([hidden]))))",
      ].map(anchoredHas);
      return {
        detects,
        allows,
        offenders,
        anchored,
        selectors,
        nodes: document.querySelectorAll("#canvas .layer").length,
      };
    });
    assert.equal(result.nodes, 500);
    assert.ok(result.selectors > 100, "inspect the loaded production stylesheets");
    assert.deepEqual(
      result.offenders,
      [],
      "no focus :has() selectors in loaded CSSOM, including nested rules",
    );
    assert.deepEqual(
      result.detects,
      [true, true, true, true, true],
      "the anchored :has() detector works",
    );
    assert.deepEqual(
      result.allows,
      [false, false, false, false],
      "and leaves other :has() rules alone",
    );
    assert.deepEqual(
      result.anchored,
      [],
      "no :has() whose subject is #canvas or an ancestor (state classes/attributes set by JS instead)",
    );
    // Keyboard focus on the row itself must expose its actions (old :has() only saw descendants).
    const row = page.locator(".layer-row").first();
    await row.focus();
    assert.equal(await row.locator("button").last().isVisible(), true);
    console.log("canvas-css-invalidation: ok");
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
