// Platform layer contract (web/platform.js, web/src/lib/platform.ts, web/src/lib/desktop-api.ts): the typed
// DesktopApi member tree matches what desktop/preload.cjs exposes, every capability names real preload methods,
// and the capability list is the same in the classic script and the TypeScript module.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");

/** Runs the preload with a stub `electron` and returns what it exposes on the main world. */
function exposedByPreload() {
  const exposed = {};
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "electron")
      return {
        contextBridge: { exposeInMainWorld: (key, value) => (exposed[key] = value) },
        ipcRenderer: { invoke() {}, on() {}, removeListener() {}, send() {} },
      };
    return load.call(this, request, ...rest);
  };
  try {
    const file = path.join(root, "desktop/preload.cjs");
    delete require.cache[file];
    require(file);
  } finally {
    Module._load = load;
  }
  return exposed;
}
/** {name: fn | {…}} → {name: true | {…}}; anything else is reported as its type. */
const shapeOf = (object) =>
  Object.fromEntries(
    Object.entries(object).map(([key, value]) => [
      key,
      typeof value === "function"
        ? true
        : value && typeof value === "object"
          ? shapeOf(value)
          : typeof value,
    ]),
  );
const methodPaths = (shape, prefix = "") =>
  Object.entries(shape).flatMap(([key, value]) =>
    value === true ? [prefix + key] : methodPaths(value, prefix + key + "."),
  );
/** Evaluates web/platform.js the way a page does (classic script) with the given `window.desktop`. */
function platformWith(desktop) {
  const context = vm.createContext(desktop === undefined ? {} : { desktop });
  vm.runInContext(fs.readFileSync(path.join(root, "web/platform.js"), "utf8"), context, {
    filename: "web/platform.js",
  });
  return context.verynizePlatform;
}

test("DesktopApi (web/src/lib/desktop-api.ts) lists exactly the methods desktop/preload.cjs exposes", async () => {
  const exposed = exposedByPreload();
  assert.deepEqual(Object.keys(exposed), ["desktop"], "the preload exposes only window.desktop");
  const { DESKTOP_API_SHAPE } = await import(
    pathToFileURL(path.join(root, "web/src/lib/desktop-api.ts")).href
  );
  const preload = new Set(methodPaths(shapeOf(exposed.desktop)));
  const typed = new Set(methodPaths(DESKTOP_API_SHAPE));
  const missing = [...preload].filter((name) => !typed.has(name));
  const stale = [...typed].filter((name) => !preload.has(name));
  assert.deepEqual(missing, [], "preload methods missing from DesktopApi / DESKTOP_API_SHAPE");
  assert.deepEqual(stale, [], "DesktopApi members the preload no longer exposes");
  assert.deepEqual(shapeOf(exposed.desktop), DESKTOP_API_SHAPE);
});

test("capabilities are the same in web/platform.js and platform.ts and name preload methods", async () => {
  const { CAPABILITIES } = await import(
    pathToFileURL(path.join(root, "web/src/lib/platform.ts")).href
  );
  const { CAPABILITY_METHODS } = platformWith(undefined);
  assert.deepEqual(
    Object.keys(CAPABILITY_METHODS).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [...CAPABILITIES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const preload = new Set(methodPaths(shapeOf(exposedByPreload().desktop)));
  for (const [name, methods] of Object.entries(CAPABILITY_METHODS)) {
    assert.ok(methods.length, `${name} needs at least one method`);
    for (const method of methods)
      assert.ok(preload.has(method), `${name}: ${method} is not a preload method`);
  }
});

test("platform: web without window.desktop, every capability with the full preload", () => {
  const web = platformWith(undefined);
  assert.equal(web.kind, "web");
  assert.equal(web.desktop, null);
  assert.ok(Object.values(web.capabilities).every((value) => value === false));
  assert.equal(web.can("projects"), false);

  const bridge = exposedByPreload().desktop;
  const desktop = platformWith(bridge);
  assert.equal(desktop.kind, "desktop");
  assert.equal(desktop.desktop, bridge);
  for (const name of Object.keys(desktop.capabilities)) assert.equal(desktop.can(name), true, name);
  assert.equal(desktop.can("noSuchCapability"), false);
  assert.equal(desktop.can("toString"), false, "only own capability names count");
  assert.ok(Object.isFrozen(desktop) && Object.isFrozen(desktop.capabilities));

  // A partial bridge (an older preload) only unlocks the capabilities whose methods are all there.
  const partial = platformWith({ openExternal() {}, devServer: { status() {} } });
  assert.equal(partial.kind, "desktop");
  assert.equal(partial.can("externalLinks"), true);
  assert.equal(partial.can("devServer"), false);
});

test("platform: loading the script twice keeps the first object", () => {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.join(root, "web/platform.js"), "utf8");
  vm.runInContext(source, context);
  const first = context.verynizePlatform;
  context.desktop = { openExternal() {} };
  vm.runInContext(source, context);
  assert.equal(context.verynizePlatform, first);
  assert.equal(context.verynizePlatform.kind, "web");
});

test("platform.agents: the chat transport registry is separate from the desktop capabilities", () => {
  const web = platformWith(undefined);
  assert.equal(web.agents.service(), null);
  assert.equal(web.agents.ready(), false);
  assert.ok(Object.isFrozen(web.agents));
  let ready = false;
  let calls = 0;
  const unsubscribe = web.agents.subscribe(() => calls++);
  const service = { kind: "web", ready: () => ready };
  const withdraw = web.agents.provide(service);
  assert.equal(web.agents.service(), service);
  assert.equal(web.agents.ready(), false, "registered but not ready (e.g. signed out)");
  ready = true;
  web.agents.changed();
  assert.equal(web.agents.ready(), true);
  assert.equal(calls, 2, "provide and changed notify subscribers");
  // A web transport never turns on a desktop capability.
  assert.equal(web.can("agents"), false);
  assert.ok(Object.values(web.capabilities).every((value) => value === false));
  withdraw();
  assert.equal(web.agents.service(), null);
  unsubscribe();
  web.agents.changed();
  assert.equal(calls, 3);
});
