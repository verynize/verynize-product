// desktop/ipc-contract.ts must name every invoke channel exactly once: the typed `handle` in main.cjs and
// `call` in preload.cjs reject unknown names, but feature modules (registerX(handle, …)) receive an
// untyped handle, so a channel registered there could drift out of the contract unnoticed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const desktop = path.join(__dirname, "../desktop");
const read = (name) => fs.readFileSync(path.join(desktop, name), "utf8");
const sorted = (values) => [...values].sort();

const contract = new Set();
const body = /export interface IpcContract \{([\s\S]*?)\n\}/.exec(read("ipc-contract.ts"));
assert.ok(body, "desktop/ipc-contract.ts declares IpcContract");
for (const [, name] of body[1].matchAll(/^ {2}(\w+):/gm)) contract.add(name);

test("every handle() channel in desktop/*.cjs is a literal declared in the IPC contract", () => {
  const handled = new Map();
  for (const file of fs.readdirSync(desktop).filter((name) => name.endsWith(".cjs"))) {
    const source = read(file).replace(/^\s*(\/\/|\*).*$/gm, "");
    for (const [, name] of source.matchAll(/\bhandle\(\s*["'`](\w+)["'`]/g)) {
      assert.ok(!handled.has(name), `${name} is registered twice (${handled.get(name)}, ${file})`);
      handled.set(name, file);
    }
    for (const match of source.matchAll(/(?<![\w.])handle\(\s*(?![\s"'`])([^)]{0,40})/g))
      assert.fail(`${file}: handle(${match[1]}…) must name its channel with a string literal`);
  }
  assert.deepEqual(sorted(handled.keys()), sorted(contract));
});

test("every preload call() channel is declared in the IPC contract and registered", () => {
  const source = read("preload.cjs");
  const called = new Set();
  for (const [, name] of source.matchAll(/\bcall\(\s*["'`](\w+)["'`]/g)) called.add(name);
  assert.equal(
    [...source.matchAll(/\bcall\(\s*(?![\s"'`])/g)].length,
    0,
    "preload names every channel literally",
  );
  assert.deepEqual(sorted(called), sorted(contract));
});
