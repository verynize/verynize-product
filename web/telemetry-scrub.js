// Privacy filter for crash and error reports (Sentry). ONE implementation shared by every surface: the desktop main
// process (desktop/telemetry.cjs), the desktop renderer (web/src/telemetry.ts), the web client
// (web-start/src/telemetry.ts) and the servers (web-start/src/server.cloudflare.ts, server/telemetry.mjs). A classic
// script like web/document-core.js: bundles import it for its side effect, Node requires it, and it registers
// globalThis.verynizeTelemetryScrub.
//
// Events are REBUILT from an allowlist instead of deleting known-bad fields, so a field a future SDK adds is dropped
// until it is listed here. Free text that survives (exception messages, breadcrumb messages, span descriptions) goes
// through scrubString: emails, home-directory paths and usernames, URL credentials, query strings and fragments
// (room invitations, capability links), bearer tokens, JWTs and long random tokens are replaced. User, request
// bodies, headers, cookies, local variables, source context lines, extras and console breadcrumbs are never kept,
// so document contents, prompts and agent output cannot leave through them.
//
//   scrubString(text)         -> text with secrets and personal data replaced
//   scrubUrl(url)             -> scheme://host/path only (no credentials, query or fragment; id-like segments → :id)
//   scrubEvent(event)         -> a new event built from allowed fields (errors and transactions); null for an
//                                expected client error ("[4xx] …", thrown by cloud/http.js rpcFail in Durable Objects)
//   scrubBreadcrumb(crumb)    -> a new breadcrumb, or null for categories that are not allowed
//   scrubStreamedSpan(span)   -> a span (beforeSendSpan, streamed traces) with allowed attributes only
//   setLiterals([home, user]) -> exact strings to replace too (the main process passes os.homedir() and the username)
//   DATA_COLLECTION           -> the SDK `dataCollection` option: collect nothing optional
(function (root) {
  "use strict";
  if (root.verynizeTelemetryScrub) return;

  const MAX_TEXT = 1000;
  const URL_IN_TEXT = /\b(?:https?|wss?|app|file|verynize):\/\/[^\s"'`<>()[\]{}]+/gi;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  // /Users/<name>, /home/<name>, /var/home/<name>, C:\Users\<name> (also JSON-escaped backslashes).
  const HOME =
    /(\/Users\/|\/home\/|\/var\/home\/|\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/))(?!<user>)[^\\/\s"'`:;,)\]}>]+/gi;
  const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
  const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
  const SECRET_ASSIGNMENT =
    /\b((?:access[_-]?|refresh[_-]?|id[_-]?|api[_-]?|auth[_-]?|session[_-]?|invite[_-]?|switch)?(?:token|key|secret|password|passwd|pwd|signature|cookie|credential|authorization)|(?:auth|oauth|invite|verification)[_-]?code)(\s*[=:]\s*["']?)[^\s"'&,;]+/gi;
  const PREFIXED_KEY =
    /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|ghu|ghs|ghr|github_pat|xox[abprs])_?[A-Za-z0-9_-]{16,}/g;
  // Long random strings (capability tokens, room secrets, hashes): 24+ characters mixing letters and digits.
  const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g;
  const ID_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;

  let literals = [];

  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** Exact strings to replace: paths become ~, names become <user>. Short values (< 3 characters) are ignored. */
  function setLiterals(values) {
    literals = (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === "string" && value.trim().length >= 3)
      .sort((a, b) => b.length - a.length)
      .map((value) => {
        const path = /[\\/]/.test(value);
        return {
          pattern: new RegExp(
            path ? escapeRegExp(value) : `\\b${escapeRegExp(value)}\\b`,
            path ? "g" : "gi",
          ),
          replacement: path ? "~" : "<user>",
        };
      });
  }

  const decode = (segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };

  function scrubPathname(pathname) {
    return pathname
      .split("/")
      .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : decode(segment)))
      .join("/");
  }

  /** scheme://host/path, without credentials, query string or fragment. */
  function scrubUrl(value) {
    if (typeof value !== "string" || !value) return "";
    let text = value;
    for (const { pattern, replacement } of literals) text = text.replace(pattern, replacement);
    let url;
    try {
      url = new URL(text);
    } catch {
      // A relative URL or a route: keep its path only.
      return scrubText(text.split(/[?#]/)[0], false);
    }
    const host = url.host ? `//${url.host}` : url.protocol === "file:" ? "//" : "";
    return scrubText(`${url.protocol}${host}${scrubPathname(url.pathname)}`, false);
  }

  function scrubText(text, withUrls) {
    let out = text;
    for (const { pattern, replacement } of literals) out = out.replace(pattern, replacement);
    if (withUrls) out = out.replace(URL_IN_TEXT, (match) => scrubUrl(match));
    return out
      .replace(HOME, "$1<user>")
      .replace(BEARER, "$1 <redacted>")
      .replace(JWT, "<token>")
      .replace(SECRET_ASSIGNMENT, "$1$2<redacted>")
      .replace(PREFIXED_KEY, "<token>")
      .replace(EMAIL, "<email>")
      .replace(LONG_TOKEN, "<token>");
  }

  /** Free text with every personal or secret value replaced, at most 1000 characters. */
  function scrubString(value) {
    if (value === undefined || value === null) return "";
    const text = scrubText(String(value), true);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
  }

  const isPrimitive = (value) =>
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const urlKey = (key) => /(^|[._])(url|href|from|to|full)$/i.test(key);
  // Identifiers Sentry needs verbatim (a scrubbed event or trace id is rejected): kept only in their exact format.
  const ID_KEYS =
    /^(event_id|trace_id|span_id|parent_span_id|debug_id|code_id|uuid|public_key|org_id|exception_id|parent_id|image_addr|instruction_addr|symbol_addr|image_vmaddr)$/;
  const ID_VALUE = /^(0x)?[0-9a-f-]{1,64}$/i;
  // Build identity, set by our own configuration: kept as is (a release may be a 40-character commit SHA).
  const RAW_KEYS = /^(release|dist|environment|sentry\.release|sentry\.environment|sentry\.dist)$/;
  const RAW_VALUE = /^[\w.@+:/-]{1,200}$/;

  /** A primitive value for `key`: identifiers and build identity verbatim, URLs as URLs, other text scrubbed. */
  function scrubValue(key, value) {
    if (typeof value !== "string") return value;
    if (ID_KEYS.test(key)) return ID_VALUE.test(value) ? value : undefined;
    if (RAW_KEYS.test(key)) return RAW_VALUE.test(value) ? value : undefined;
    return urlKey(key) ? scrubUrl(value) : scrubString(value);
  }

  /** Copies the listed keys whose values are primitives, through scrubValue. */
  function pick(source, keys) {
    const out = {};
    if (!isObject(source)) return out;
    for (const key of keys) {
      if (!own(source, key) || !isPrimitive(source[key])) continue;
      const value = scrubValue(key, source[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  /** Copies every primitive entry whose key matches `allowed`. */
  function pickMatching(source, allowed) {
    if (!isObject(source)) return undefined;
    const keys = Object.keys(source).filter((key) => allowed.test(key));
    return keys.length ? pick(source, keys) : undefined;
  }

  const FRAME_KEYS = [
    "filename",
    "abs_path",
    "function",
    "module",
    "lineno",
    "colno",
    "in_app",
    "platform",
    "instruction_addr",
    "addr_mode",
    "symbol_addr",
    "image_addr",
    "package",
    "trust",
    "debug_id",
  ];
  function scrubFrame(frame) {
    const out = pick(frame, FRAME_KEYS);
    // Paths keep their (scrubbed) form: Sentry resolves source maps by debug id and app:// paths.
    for (const key of ["filename", "abs_path", "package"])
      if (typeof out[key] === "string")
        out[key] = scrubText(String(frame[key]), false).slice(0, MAX_TEXT);
    return out;
  }

  function scrubStacktrace(stacktrace) {
    if (!isObject(stacktrace) || !Array.isArray(stacktrace.frames)) return undefined;
    return { frames: stacktrace.frames.slice(-100).filter(isObject).map(scrubFrame) };
  }

  function scrubException(exception) {
    const out = pick(exception, ["type", "value", "module", "thread_id"]);
    if (isObject(exception.mechanism))
      out.mechanism = pick(exception.mechanism, [
        "type",
        "handled",
        "synthetic",
        "source",
        "is_exception_group",
        "exception_id",
        "parent_id",
      ]);
    const stacktrace = scrubStacktrace(exception.stacktrace);
    if (stacktrace) out.stacktrace = stacktrace;
    return out;
  }

  function scrubThread(thread) {
    const out = pick(thread, ["id", "crashed", "current", "main"]);
    const stacktrace = scrubStacktrace(thread.stacktrace);
    if (stacktrace) out.stacktrace = stacktrace;
    return out;
  }

  // Contexts: only these, and only their primitive fields (device has no name, os has no hostname).
  const CONTEXTS = {
    app: [
      "app_name",
      "app_version",
      "app_build",
      "app_start_time",
      "app_memory",
      "build_type",
      "in_foreground",
    ],
    os: ["name", "version", "build", "kernel_version", "type"],
    device: [
      "arch",
      "family",
      "model",
      "model_id",
      "memory_size",
      "free_memory",
      "processor_count",
      "processor_frequency",
      "cpu_description",
      "screen_resolution",
      "screen_density",
      "screen_width_pixels",
      "screen_height_pixels",
      "simulator",
      "online",
      "type",
    ],
    runtime: ["name", "version", "type"],
    browser: ["name", "version", "type"],
    chrome: ["name", "version", "type"],
    node: ["name", "version", "type"],
    electron: ["crashed_process", "crashed_url", "details", "exit_code", "reason", "type"],
    gpu: [
      "name",
      "vendor_name",
      "vendor_id",
      "id",
      "driver_version",
      "memory_size",
      "api_type",
      "type",
    ],
    response: ["status_code", "type"],
    cloud_resource: ["cloud.provider", "cloud.platform", "type"],
    react: ["componentStack"],
  };
  const SPAN_DATA =
    /^(sentry\.(op|origin|source|sample_rate|idle_span_finish_reason)|http\.(method|request\.method|response\.status_code|response_content_length|response\.body\.size|response_transfer_size|decoded_response_content_length)|network\.protocol\.(name|version)|server\.address|url(\.full|\.scheme|\.path)?|http\.url|type|route|ui\.component_name|resource\.render_blocking_status|navigation\.type|performance\..+|lcp\..+|cls\..+|frames\..+|thread\.(id|name)|status_code|electron\..+|app_start_type|cloudflare\..+|faas\..+)$/;

  function scrubTrace(trace) {
    const out = pick(trace, [
      "trace_id",
      "span_id",
      "parent_span_id",
      "op",
      "status",
      "origin",
      "description",
      "sampled",
      "sample_rate",
    ]);
    const data = pickMatching(trace.data, SPAN_DATA);
    if (data) out.data = data;
    return out;
  }

  function scrubContexts(contexts) {
    if (!isObject(contexts)) return undefined;
    const out = {};
    for (const [name, keys] of Object.entries(CONTEXTS)) {
      const picked = isObject(contexts[name]) ? pick(contexts[name], keys) : {};
      if (Object.keys(picked).length) out[name] = picked;
    }
    if (isObject(contexts.trace)) out.trace = scrubTrace(contexts.trace);
    return out;
  }

  const TAGS =
    /^(event\.(process|origin|environment)|handled|mechanism|level|surface|runtime_target|area|os|os\.name|browser|browser\.name|runtime|runtime\.name|device|device\.family|electron\.process|transaction|url|http\.status_code|cloudflare\..+)$/;

  function scrubSpan(span) {
    const out = pick(span, [
      "span_id",
      "trace_id",
      "parent_span_id",
      "op",
      "status",
      "origin",
      "description",
      "start_timestamp",
      "timestamp",
      "exclusive_time",
      "same_process_as_parent",
    ]);
    const data = pickMatching(span.data, SPAN_DATA);
    if (data) out.data = data;
    return out;
  }

  function scrubMeasurements(measurements) {
    if (!isObject(measurements)) return undefined;
    const out = {};
    for (const [name, value] of Object.entries(measurements))
      if (/^[a-z0-9_.]{1,64}$/i.test(name) && isObject(value) && typeof value.value === "number")
        out[name] = pick(value, ["value", "unit"]);
    return out;
  }

  function scrubDebugMeta(debugMeta) {
    if (!isObject(debugMeta) || !Array.isArray(debugMeta.images)) return undefined;
    return {
      images: debugMeta.images.filter(isObject).map((image) => {
        const out = pick(image, [
          "type",
          "debug_id",
          "code_id",
          "code_file",
          "debug_file",
          "image_addr",
          "image_size",
          "image_vmaddr",
          "arch",
          "uuid",
        ]);
        for (const key of ["code_file", "debug_file"])
          if (typeof image[key] === "string") out[key] = scrubText(image[key], false);
        return out;
      }),
    };
  }

  const BREADCRUMB_CATEGORIES =
    /^(navigation|fetch|xhr|http|electron\.net|net|ui\.click|ui\.input|ui\.keypress|electron|sentry\.event|sentry\.transaction|child_process|app|browser-window|web-contents|power-monitor|screen)$/;
  const BREADCRUMB_DATA = /^(method|url|from|to|status_code|reason|exit_code|signal|name)$/;

  /** A new breadcrumb with allowed fields only; console logs and unknown categories are dropped. */
  function scrubBreadcrumb(breadcrumb) {
    if (!isObject(breadcrumb) || typeof breadcrumb.category !== "string") return null;
    if (!BREADCRUMB_CATEGORIES.test(breadcrumb.category)) return null;
    // The app loading its own files (app:// served from disk) says nothing and names install paths.
    const url = isObject(breadcrumb.data) ? breadcrumb.data.url : undefined;
    if (typeof url === "string" && /^file:/i.test(url)) return null;
    const out = pick(breadcrumb, ["type", "category", "level", "timestamp"]);
    if (breadcrumb.message !== undefined)
      out.message = scrubString(breadcrumb.message).slice(0, 300);
    const data = pickMatching(breadcrumb.data, BREADCRUMB_DATA);
    if (data) out.data = data;
    return out;
  }

  // Span attributes (streamed spans, SDK 11's default trace lifecycle): instrumentation and timing only.
  const SPAN_ATTRIBUTES =
    /^(sentry\.(?!user).+|http\.(method|request\.method|response\.status_code|response_content_length|response\.body\.size|response_transfer_size|decoded_response_content_length|route)|network\.protocol\.(name|version)|server\.(address|port)|url\.(full|path|scheme|template)|http\.url|url|type|route|ui\..+|resource\..+|navigation\.type|performance\..+|(lcp|cls|inp|fcp|fp|ttfb|frames|browser\.web_vital)\..+|browser\.(name|version)|os\.(name|version)|device\.(brand|model|family)|electron\..+|app_start_type|cloudflare\..+|faas\..+|thread\.(id|name)|code\.function\.name|transaction\.(op|source)|process\.runtime\.(name|version))$/;

  function scrubAttribute(key, value) {
    if (isPrimitive(value)) return scrubValue(key, value);
    if (Array.isArray(value)) {
      const items = value.filter(isPrimitive).map((item) => scrubValue(key, item));
      return items.length ? items : undefined;
    }
    if (isObject(value) && own(value, "value")) {
      const inner = scrubAttribute(key, value.value);
      return inner === undefined ? undefined : { ...pick(value, ["type", "unit"]), value: inner };
    }
    return undefined;
  }

  /** A streamed span (beforeSendSpan) with allowed attributes only. Spans cannot be dropped here, only emptied. */
  function scrubStreamedSpan(span) {
    if (!isObject(span)) return span;
    const out = pick(span, [
      "trace_id",
      "span_id",
      "parent_span_id",
      "name",
      "start_timestamp",
      "end_timestamp",
      "status",
      "is_segment",
    ]);
    if (typeof out.name !== "string") out.name = "";
    out.attributes = {};
    if (isObject(span.attributes))
      for (const [key, value] of Object.entries(span.attributes)) {
        if (!SPAN_ATTRIBUTES.test(key)) continue;
        const scrubbed = scrubAttribute(key, value);
        if (scrubbed !== undefined) out.attributes[key] = scrubbed;
      }
    return out;
  }

  /** Dynamic sampling context (trace envelope header): no user segment, transaction names scrubbed. */
  function scrubProcessingMetadata(metadata) {
    if (!isObject(metadata)) return undefined;
    const out = { ...metadata };
    if (isObject(metadata.dynamicSamplingContext)) {
      out.dynamicSamplingContext = pick(metadata.dynamicSamplingContext, [
        "trace_id",
        "public_key",
        "sample_rate",
        "sample_rand",
        "sampled",
        "release",
        "environment",
        "transaction",
        "org_id",
      ]);
    }
    for (const key of [
      "normalizedRequest",
      "ipAddress",
      "requestSession",
      "capturedSpanIsolationScope",
    ])
      delete out[key];
    return out;
  }

  // `rpcFail` (cloud/http.js) throws "[status] message" because Durable Object RPC loses error fields; Sentry's Durable
  // Object wrapper reports it before the Worker turns it back into a response. Statuses below 500 are answers, not faults.
  const EXPECTED_STATUS = /^(?:\w*Error: )?\[[1-4]\d\d\] /;
  // The thrown error is the last value (earlier ones are its causes).
  const expectedStatus = (event) => {
    const values = isObject(event.exception) ? event.exception.values : null;
    const thrown = Array.isArray(values) ? values[values.length - 1] : null;
    return (
      isObject(thrown) && typeof thrown.value === "string" && EXPECTED_STATUS.test(thrown.value)
    );
  };

  /** A new event built from allowed fields only. Returns null for anything that is not an object, or an expected 4xx. */
  function scrubEvent(event) {
    if (!isObject(event) || expectedStatus(event)) return null;
    const out = pick(event, [
      "event_id",
      "timestamp",
      "start_timestamp",
      "level",
      "platform",
      "logger",
      "type",
      "release",
      "dist",
      "environment",
      "transaction",
    ]);
    if (isObject(event.transaction_info))
      out.transaction_info = pick(event.transaction_info, ["source"]);
    if (typeof event.message === "string") out.message = scrubString(event.message);
    else if (isObject(event.message))
      out.message = scrubString(event.message.formatted || event.message.message);
    // A log entry keeps its message, never its parameters.
    if (isObject(event.logentry))
      out.logentry = { message: scrubString(event.logentry.formatted || event.logentry.message) };
    if (isObject(event.exception) && Array.isArray(event.exception.values))
      out.exception = {
        values: event.exception.values.slice(0, 10).filter(isObject).map(scrubException),
      };
    if (isObject(event.threads) && Array.isArray(event.threads.values))
      out.threads = { values: event.threads.values.slice(0, 50).filter(isObject).map(scrubThread) };
    const tags = pickMatching(event.tags, TAGS);
    if (tags) out.tags = tags;
    const contexts = scrubContexts(event.contexts);
    if (contexts) out.contexts = contexts;
    // infer_ip "never": without it Sentry fills user.ip_address (and geo) from the connection at ingest.
    out.sdk = { settings: { infer_ip: "never" } };
    if (isObject(event.sdk)) {
      out.sdk = { ...pick(event.sdk, ["name", "version"]), settings: { infer_ip: "never" } };
      if (Array.isArray(event.sdk.integrations))
        out.sdk.integrations = event.sdk.integrations
          .filter((name) => typeof name === "string")
          .slice(0, 100);
      if (Array.isArray(event.sdk.packages))
        out.sdk.packages = event.sdk.packages
          .filter(isObject)
          .map((item) => pick(item, ["name", "version"]));
    }
    if (isObject(event.request)) {
      const request = pick(event.request, ["method"]);
      if (typeof event.request.url === "string") request.url = scrubUrl(event.request.url);
      out.request = request;
    }
    if (Array.isArray(event.breadcrumbs))
      out.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean).slice(-50);
    if (Array.isArray(event.fingerprint))
      out.fingerprint = event.fingerprint
        .filter((part) => typeof part === "string")
        .map(scrubString);
    const debugMeta = scrubDebugMeta(event.debug_meta);
    if (debugMeta) out.debug_meta = debugMeta;
    if (Array.isArray(event.spans))
      out.spans = event.spans.filter(isObject).slice(0, 1000).map(scrubSpan);
    const measurements = scrubMeasurements(event.measurements);
    if (measurements) out.measurements = measurements;
    // Never serialised; carries the trace header and SDK-internal markers (renderer events in Electron).
    const metadata = scrubProcessingMetadata(event.sdkProcessingMetadata);
    if (metadata) out.sdkProcessingMetadata = metadata;
    return out;
  }

  /** The SDK `dataCollection` option: nothing optional is collected (no IP, headers, bodies, cookies, variables). */
  const DATA_COLLECTION = Object.freeze({
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  });

  root.verynizeTelemetryScrub = Object.freeze({
    scrubString,
    scrubUrl,
    scrubEvent,
    scrubBreadcrumb,
    scrubStreamedSpan,
    setLiterals,
    DATA_COLLECTION,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
