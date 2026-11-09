// Desktop crash reports (desktop/telemetry.cjs): which pages may report, and which process losses become events.
// Our own render windows report as `render` but never send a native dump; foreign pages stay dropped.
const test = require("node:test");
const assert = require("node:assert/strict");
const telemetry = require("../desktop/telemetry.cjs");

test("pages are named by origin", () => {
  assert.equal(telemetry.rendererName(""), "renderer", "the editor before its first load");
  assert.equal(telemetry.rendererName("app://verynize/index.html"), "renderer");
  assert.equal(telemetry.rendererName("verynize-render://document/"), "render");
  for (const url of [
    "https://example.dev/",
    "http://localhost:5173/",
    "data:text/html,x",
    "about:blank",
  ])
    assert.equal(telemetry.rendererName(url), "untrusted", url);
});

test("events kept before scrubbing", () => {
  const event = (tags) => ({ tags });
  assert.equal(telemetry.keepEvent(event({ "event.process": "renderer" })), true);
  assert.equal(telemetry.keepEvent(event({ "event.process": "browser" })), true);
  assert.equal(telemetry.keepEvent(event({ "event.process": "untrusted" })), false);
  assert.equal(telemetry.keepEvent(event({ "event.process": "render" })), true);
  assert.equal(
    telemetry.keepEvent(event({ "event.process": "render", "event.environment": "native" })),
    false,
    "a render window's dump holds the document",
  );
  assert.equal(telemetry.keepEvent({}), true);
});

test("crashed, oom and killed are events", () => {
  for (const reason of ["crashed", "oom", "killed", "abnormal-exit", "launch-failed"])
    assert.ok(telemetry.PROCESS_EVENTS.includes(reason), reason);
  assert.ok(!telemetry.PROCESS_EVENTS.includes("clean-exit"));
});
