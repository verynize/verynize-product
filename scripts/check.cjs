require("./check-async-waits.cjs").check();
require("./check-css-has.cjs").check();
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
for (const directory of [
  "desktop",
  "web",
  "integrations",
  "cloud",
  "scripts",
  "tests",
  "tests/helpers",
  "web-start",
  "web-start/build",
  "web-start/node",
]) {
  for (const name of fs.readdirSync(directory))
    if (/\.(cjs|mjs|js)$/.test(name))
      execFileSync(process.execPath, ["--check", path.join(directory, name)], { stdio: "inherit" });
}
const html = fs.readFileSync("web/index.html", "utf8");
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!/^(https?:|data:|#)/.test(match[1]) && !fs.existsSync(path.join("web", match[1])))
    throw Error("Missing entry asset: " + match[1]);
}
console.log("All JavaScript syntax and entry asset checks passed");
