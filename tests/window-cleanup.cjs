// Per-window cleanup registry: one `closed` listener per window, however many modules register cleanups.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { onWindowClosed } = require("../desktop/window-cleanup.cjs");

test("many cleanups share one closed listener and run once, in order", () => {
  const win = new EventEmitter(),
    ran = [];
  for (let i = 0; i < 25; i++) onWindowClosed(win, () => ran.push(i));
  assert.equal(
    win.listenerCount("closed"),
    1,
    "no MaxListenersExceededWarning however many modules register",
  );
  win.emit("closed");
  win.emit("closed");
  assert.deepEqual(
    ran,
    Array.from({ length: 25 }, (_, i) => i),
  );
  assert.equal(win.listenerCount("closed"), 0);
});

test("short-lived work can unregister, and a failing cleanup does not stop the others", () => {
  const win = new EventEmitter(),
    ran = [],
    error = console.error;
  const off = onWindowClosed(win, () => ran.push("render"));
  onWindowClosed(win, () => {
    throw new Error("boom");
  });
  onWindowClosed(win, () => ran.push("terminal"));
  off();
  console.error = () => {};
  try {
    win.emit("closed");
  } finally {
    console.error = error;
  }
  assert.deepEqual(ran, ["terminal"]);
  assert.doesNotThrow(() => onWindowClosed(null, () => {})());
});
