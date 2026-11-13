// Crash-report privacy filter (web/telemetry-scrub.js): events are rebuilt from an allowlist, and free text loses
// emails, home-directory paths, usernames and tokens. Fixtures are invented (alice, bob, example.dev).
const test = require("node:test");
const assert = require("node:assert/strict");
require("../web/telemetry-scrub.js");

const scrub = globalThis.verynizeTelemetryScrub;
const SECRETS = [
  "alice@example.dev",
  "bob.smith+tag@mail.example.org",
  "/Users/alice",
  "/home/bob",
  "C:\\Users\\Carol",
  "C:\\\\Users\\\\Carol",
  "abcdef0123456789abcdef0123456789",
  "sk-live-0123456789abcdefABCDEF",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2lnbmF0dXJl",
  "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA",
  "s3cr3t-value",
  "hunter2pass",
];
const leaks = (value) => {
  const text = JSON.stringify(value);
  return SECRETS.filter(
    (secret) => text.includes(secret.replace(/\\/g, "\\\\")) || text.includes(secret),
  );
};

test("scrubString removes emails, home paths and tokens", () => {
  const cases = [
    ["Failed for alice@example.dev and bob.smith+tag@mail.example.org", "<email>"],
    ["ENOENT: open '/Users/alice/Projects/site/index.verynize.json'", "/Users/<user>/Projects"],
    ["spawn /home/bob/.local/bin/codex", "/home/<user>/.local"],
    ["EPERM C:\\Users\\Carol\\AppData\\x.json", "Users\\<user>\\AppData"],
    ['{"path":"C:\\\\Users\\\\Carol\\\\x"}', "<user>"],
    ["Authorization: Bearer abcdef0123456789abcdef0123456789", "<redacted>"],
    ["key sk-live-0123456789abcdefABCDEF rejected", "<token>"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2lnbmF0dXJl expired", "<token>"],
    ["room token Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA invalid", "room token <redacted>"],
    ["capability Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA invalid", "capability <token>"],
    ["password=s3cr3t-value&next=1", "password=<redacted>"],
    ["api_key: hunter2pass", "api_key: <redacted>"],
  ];
  for (const [input, expected] of cases) {
    const output = scrub.scrubString(input);
    assert.ok(output.includes(expected), `${input} → ${output}`);
    assert.deepEqual(leaks(output), [], `${input} → ${output}`);
  }
  assert.equal(scrub.scrubString("exit code: 1"), "exit code: 1", "ordinary diagnostics survive");
});

test("URLs keep scheme, host and path only", () => {
  assert.equal(
    scrub.scrubUrl(
      "https://alice:pw@verynize.example.dev/api/rooms/r0om1d2345678901234/socket?token=abc#room=xyz",
    ),
    "https://verynize.example.dev/api/rooms/:id/socket",
  );
  assert.equal(
    scrub.scrubUrl("app://verynize/editor?file=/Users/alice/a.json#x"),
    "app://verynize/editor",
  );
  const once = scrub.scrubUrl("app://verynize/editor/f1le2id3456789abcdef");
  assert.equal(once, "app://verynize/editor/:id");
  assert.equal(scrub.scrubUrl(once), once, "scrubbing a scrubbed URL changes nothing");
  assert.equal(
    scrub.scrubUrl("file:///Users/alice/site/index.html"),
    "file:///Users/<user>/site/index.html",
  );
  assert.equal(
    scrub.scrubString("GET https://verynize.example.dev/api/me?invite=Zm9vYmFy failed"),
    "GET https://verynize.example.dev/api/me failed",
  );
});

test("literals: this machine's home directory and username", () => {
  scrub.setLiterals(["/Users/zed.smith", "zedsmith"]);
  try {
    assert.equal(
      scrub.scrubString("at /Users/zed.smith/app/x.js by zedsmith"),
      "at ~/app/x.js by <user>",
    );
  } finally {
    scrub.setLiterals([]);
  }
});

test("scrubEvent rebuilds the event from allowed fields only", () => {
  const event = {
    event_id: "0123456789abcdef0123456789abcdef",
    timestamp: 1730000000,
    level: "error",
    platform: "javascript",
    release: "0123456789abcdef0123456789abcdef01234567",
    environment: "production",
    message: "Saving /Users/alice/x.verynize.json for alice@example.dev",
    user: { id: "u1", email: "alice@example.dev", ip_address: "203.0.113.9", username: "alice" },
    server_name: "alices-macbook.local",
    extra: { document: { nodes: [{ text: "secret design copy" }] }, prompt: "make it pop" },
    request: {
      url: "https://verynize.example.dev/api/rooms?token=abcdef0123456789abcdef0123456789",
      method: "POST",
      headers: { authorization: "Bearer abcdef0123456789abcdef0123456789", cookie: "s=1" },
      data: '{"text":"secret design copy"}',
      cookies: { s: "1" },
      query_string: "token=abcdef0123456789abcdef0123456789",
    },
    tags: { "event.process": "renderer", email: "alice@example.dev", surface: "desktop" },
    contexts: {
      os: { name: "macOS", version: "15.1", hostname: "alices-macbook" },
      device: { arch: "arm64", name: "Alice's MacBook" },
      app: { app_version: "0.18.0", app_name: "Verynize" },
      culture: { locale: "en-US", timezone: "Europe/Amsterdam" },
      state: { design: { nodes: [{ text: "secret design copy" }] } },
      trace: {
        trace_id: "a".repeat(32),
        span_id: "b".repeat(16),
        data: { "http.query": "?token=x", "http.method": "GET" },
      },
    },
    exception: {
      values: [
        {
          type: "Error",
          value: "Cannot read /home/bob/notes.txt (alice@example.dev)",
          mechanism: { type: "onerror", handled: false, data: { element: "secret" } },
          stacktrace: {
            frames: [
              {
                filename: "app://verynize/app.js",
                function: "save",
                lineno: 1,
                colno: 20,
                in_app: true,
                vars: { password: "hunter2pass" },
                context_line: "const secret = 'secret design copy'",
                pre_context: ["/Users/alice"],
              },
              {
                filename: "/Users/alice/Library/x.js",
                abs_path: "C:\\Users\\Carol\\x.js",
                function: "f",
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: "console", level: "log", message: "prompt: make it pop for alice@example.dev" },
      {
        category: "navigation",
        data: {
          from: "app://verynize/editor#room=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA",
          to: "app://verynize/code",
        },
      },
      {
        category: "fetch",
        data: {
          method: "GET",
          url: "https://x.example.dev/a?code=1",
          status_code: 200,
          request_body_size: 9,
        },
      },
      { category: "custom.unknown", message: "anything" },
      {
        category: "electron.net",
        data: { method: "GET", url: "file:///Users/alice/app/web/app.js", status_code: 200 },
      },
    ],
    modules: { "/Users/alice/node_modules/x": "1.0.0" },
    debug_meta: {
      images: [{ type: "sourcemap", code_file: "/Users/alice/app.js", debug_id: "d".repeat(32) }],
    },
    sdk: { name: "sentry.javascript.electron", version: "8.3.0", integrations: ["Breadcrumbs"] },
    sdkProcessingMetadata: {
      dynamicSamplingContext: {
        trace_id: "a".repeat(32),
        public_key: "f".repeat(32),
        user_segment: "alice",
        transaction: "/editor",
      },
      normalizedRequest: { headers: { cookie: "s=1" } },
    },
  };
  const out = scrub.scrubEvent(structuredClone(event));
  assert.deepEqual(leaks(out), []);
  const text = JSON.stringify(out);
  for (const banned of [
    "secret design copy",
    "make it pop",
    "alices-macbook",
    "Alice's MacBook",
    "203.0.113.9",
    "Amsterdam",
    "cookie",
  ])
    assert.ok(!text.includes(banned), banned);
  for (const key of ["user", "server_name", "extra", "modules"])
    assert.equal(out[key], undefined, key);
  assert.deepEqual(
    out.sdk.settings,
    { infer_ip: "never" },
    "Sentry must not fill in the IP at ingest",
  );
  assert.deepEqual(scrub.scrubEvent({ message: "x" }).sdk, { settings: { infer_ip: "never" } });
  // Identifiers and the build's release stay verbatim: Sentry rejects or cannot match scrubbed ones.
  assert.equal(out.event_id, event.event_id);
  assert.equal(out.release, event.release);
  assert.equal(out.contexts.trace.trace_id, "a".repeat(32));
  assert.deepEqual(out.request, { method: "POST", url: "https://verynize.example.dev/api/rooms" });
  assert.deepEqual(out.tags, { "event.process": "renderer", surface: "desktop" });
  assert.deepEqual(Object.keys(out.contexts).sort(), ["app", "device", "os", "trace"]);
  assert.deepEqual(out.contexts.trace.data, { "http.method": "GET" });
  const [first, second] = out.exception.values[0].stacktrace.frames;
  assert.deepEqual(first, {
    filename: "app://verynize/app.js",
    function: "save",
    lineno: 1,
    colno: 20,
    in_app: true,
  });
  assert.equal(second.filename, "/Users/<user>/Library/x.js");
  assert.equal(out.exception.values[0].mechanism.data, undefined);
  assert.equal(out.exception.values[0].value, "Cannot read /home/<user>/notes.txt (<email>)");
  assert.deepEqual(
    out.breadcrumbs.map((crumb) => crumb.category),
    ["navigation", "fetch"],
    "console, unknown and local-file breadcrumbs are dropped",
  );
  assert.deepEqual(out.breadcrumbs[1].data, {
    method: "GET",
    url: "https://x.example.dev/a",
    status_code: 200,
  });
  assert.equal(
    out.debug_meta.images[0].debug_id,
    "d".repeat(32),
    "debug ids survive for source maps",
  );
  assert.deepEqual(out.sdkProcessingMetadata.dynamicSamplingContext, {
    trace_id: "a".repeat(32),
    public_key: "f".repeat(32),
    transaction: "/editor",
  });
  assert.equal(out.sdkProcessingMetadata.normalizedRequest, undefined);
  assert.deepEqual(scrub.scrubEvent(structuredClone(out)), out, "scrubbing is idempotent");
});

test("transactions keep span timing, not payloads", () => {
  const out = scrub.scrubEvent({
    type: "transaction",
    transaction: "/editor",
    start_timestamp: 1,
    timestamp: 2,
    spans: [
      {
        span_id: "c".repeat(16),
        trace_id: "a".repeat(32),
        op: "http.client",
        description:
          "POST https://verynize.example.dev/api/rooms?token=abcdef0123456789abcdef0123456789",
        start_timestamp: 1,
        timestamp: 2,
        data: {
          "http.response.status_code": 201,
          "http.request.body": "secret design copy",
          url: "https://a.example.dev/x?y=1",
        },
      },
    ],
    measurements: { lcp: { value: 120, unit: "millisecond" } },
  });
  assert.deepEqual(leaks(out), []);
  assert.equal(out.spans[0].description, "POST https://verynize.example.dev/api/rooms");
  assert.deepEqual(out.spans[0].data, {
    "http.response.status_code": 201,
    url: "https://a.example.dev/x",
  });
  assert.deepEqual(out.measurements, { lcp: { value: 120, unit: "millisecond" } });
});

test("streamed spans keep timing and instrumentation attributes only", () => {
  const span = {
    trace_id: "a".repeat(32),
    span_id: "b".repeat(16),
    name: "GET https://verynize.example.dev/api/rooms?token=abcdef0123456789abcdef0123456789",
    start_timestamp: 1,
    end_timestamp: 2,
    status: "ok",
    is_segment: false,
    attributes: {
      "sentry.op": "http.client",
      "sentry.release": "0123456789abcdef0123456789abcdef01234567",
      "http.response.status_code": { value: 200, type: "integer" },
      "url.full": {
        value: "https://verynize.example.dev/api/rooms?token=abcdef0123456789abcdef0123456789",
        type: "string",
      },
      "http.query": "?token=abcdef0123456789abcdef0123456789",
      "user.email": "alice@example.dev",
      "client.address": "203.0.113.9",
    },
    links: [{ trace_id: "c".repeat(32) }],
  };
  const out = scrub.scrubStreamedSpan(span);
  assert.deepEqual(leaks(out), []);
  assert.equal(out.name, "GET https://verynize.example.dev/api/rooms");
  assert.deepEqual(out.attributes, {
    "sentry.op": "http.client",
    "sentry.release": "0123456789abcdef0123456789abcdef01234567",
    "http.response.status_code": { type: "integer", value: 200 },
    "url.full": { type: "string", value: "https://verynize.example.dev/api/rooms" },
  });
  assert.equal(out.links, undefined);
  assert.equal(out.trace_id, "a".repeat(32));
});

test("breadcrumbs: console and unknown categories never pass", () => {
  assert.equal(scrub.scrubBreadcrumb({ category: "console", message: "hi" }), null);
  assert.equal(scrub.scrubBreadcrumb({ category: "agent.output", message: "hi" }), null);
  assert.equal(scrub.scrubBreadcrumb(null), null);
  assert.deepEqual(
    scrub.scrubBreadcrumb({
      category: "ui.click",
      message: 'button#save[title="alice@example.dev"]',
      data: { text: "x" },
    }),
    {
      category: "ui.click",
      message: 'button#save[title="<email>"]',
    },
  );
});

test("DATA_COLLECTION turns every optional collection off", () => {
  const { DATA_COLLECTION } = scrub;
  assert.equal(DATA_COLLECTION.userInfo, false);
  assert.equal(DATA_COLLECTION.cookies, false);
  assert.equal(DATA_COLLECTION.httpHeaders, false);
  assert.deepEqual(DATA_COLLECTION.httpBodies, []);
  assert.equal(DATA_COLLECTION.urlQueryParams, false);
  assert.equal(DATA_COLLECTION.stackFrameVariables, false);
  assert.equal(DATA_COLLECTION.frameContextLines, 0);
});

test("expected 4xx from Durable Object RPC are dropped, server faults kept", () => {
  const thrown = (...values) => ({
    exception: { values: values.map((value) => ({ type: "Error", value })) },
  });
  for (const value of [
    "[404] No such app",
    "[403] Forbidden",
    "[409] Revision conflict",
    "[400] Invalid account state key",
    "Error: [401] Sign in first",
  ])
    assert.equal(scrub.scrubEvent(thrown(value)), null, value);
  for (const value of ["[500] Account record is incomplete", "[503] x", "Failed [404] later"])
    assert.notEqual(scrub.scrubEvent(thrown(value)), null, value);
  // The thrown error is the last value; a 4xx cause under a 500 is still reported.
  assert.notEqual(scrub.scrubEvent(thrown("[404] cause", "[500] wrapper")), null);
  assert.equal(scrub.scrubEvent(thrown("TypeError: x", "[403] wrapper")), null);
  assert.notEqual(scrub.scrubEvent({ message: "[404] a message, not an exception" }), null);
});
