const fs = require("node:fs");
const path = require("node:path");

// Pseudo-class :has() variants can invalidate the whole workspace on every DOM insert.
// See docs/canvas-performance/README.md#root-cause-five-hasfocus-visible-rules.
// Attribute/element arguments (has-data-*, has-aria-*, has-[>svg]) remain allowed.
const pseudoVariant =
  /\b(?:(?:group|peer)-)?has-(?:\[[^\]\r\n]*:[^\]\r\n]*\]|(?!aria-|data-)[a-z][\w-]*(?=[:/[]))/g;
const focusSelector = /:has\(\s*:focus/;

function checkSource(source) {
  return [...source.matchAll(pseudoVariant)].map((match) => ({
    variant: match[0],
    line: source.slice(0, match.index).split("\n").length,
  }));
}

function check() {
  const errors = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else
        for (const hit of checkSource(fs.readFileSync(file, "utf8")))
          errors.push(
            `${file}:${hit.line}: forbidden ${hit.variant}; use focus-within, direct focus-visible, or explicit state`,
          );
    }
  }
  walk("web/src");
  if (focusSelector.test(fs.readFileSync("web/dist/ui.css", "utf8")))
    errors.push(
      "web/dist/ui.css: forbidden :has(:focus selector; rebuild after replacing source variants",
    );
  if (errors.length) throw Error(errors.join("\n"));
  console.log("CSS :has() performance guard passed");
}

module.exports = { checkSource, focusSelector, check };
if (require.main === module) check();
