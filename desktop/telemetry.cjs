// Crash and error reports (Sentry), desktop main process. Opt-in: nothing is initialised or sent until the user turns on
// Settings › Preferences › Privacy › "Send crash reports", which writes userData/telemetry.json.
//
// - start(app, {dialog})     before app ready, right after app.setName: installs the main-process uncaughtException /
//                            unhandledRejection handlers (always; they log, and report when reporting is on), reads
//                            the consent file synchronously and, when it is on and a DSN is configured, initialises
//                            @sentry/electron/main (native crash minidumps included).
// - rendererArguments()      webPreferences.additionalArguments for the editor window: the renderer half
//                            (web/src/telemetry.ts, loaded before every legacy script) reads them through
//                            window.desktop.telemetry.config() (desktop/preload.cjs).
// - registerTelemetry(handle)  telemetryGet() / telemetrySet(enabled) for the settings toggle and the first-launch
//                            question (web/src/islands/onboarding/telemetry-prompt.tsx; `asked` until either answer).
//
// Turning reports on takes effect at the next launch (the SDK must start before app ready). Turning them off is
// immediate: the client is closed, and the offline transport's shouldSend/shouldStore also refuse anything queued.
//
// Privacy: every event (main and renderer: renderer events are re-captured in main, so main's beforeSend sees them)
// is rebuilt by web/telemetry-scrub.js from an allowlist, with this machine's home directory and username replaced
// as literals. Renderer IPC uses Classic mode (no extra privileged scheme next to app://); the SDK's preload is
// injected into the default session only (preview, render, capture and passkey windows use their own partitions),
// and events from any page that is not app://verynize are dropped, except our own render windows
// (verynize-render://, desktop/render.cjs): their process loss is reported as `render`, but never their native crash
// dump, which holds the document being rendered.
//
// Process loss: `crashed`, `oom` and `killed` are events too (the SDK default reports only abnormal-exit,
// launch-failed and integrity-failure), with the lost process's name, reason and exit code in the `electron` context.
//
// Configuration (environment at run time, or desktop/telemetry-build.json written by scripts/package-macos.cjs):
//   SENTRY_DSN_DESKTOP          the verynize-desktop project DSN; none → reporting is unavailable
//   SENTRY_ENVIRONMENT          default: production when packaged, development otherwise
//   SENTRY_SAMPLE_RATE          errors, default 1
//   SENTRY_TRACES_SAMPLE_RATE   transactions, default 0.05
// Automated runs (VERYNIZE_SKIP_ONBOARDING=1, VERYNIZE_BLOCK_PRODUCTION_CLOUD=1 or CI) only ever report to a
// loopback DSN (tests/telemetry-desktop.cjs runs a local ingest server).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../web/telemetry-scrub.js");

const scrub = globalThis.verynizeTelemetryScrub;
const CONSENT_FILE = "telemetry.json";
const ARGUMENT = "--verynize-telemetry=";
const UNTRUSTED = "untrusted";
// Pages of our own helper windows, by protocol: never user or third-party content.
const INTERNAL_PAGES = { "verynize-render:": "render" };
const PROCESS_EVENTS = [
  "abnormal-exit",
  "launch-failed",
  "integrity-failure",
  "crashed",
  "oom",
  "killed",
];
// Integrations that would collect more than the allowlist keeps, or that this module replaces.
const DROPPED_INTEGRATIONS = new Set([
  "OnUncaughtException", // replaced by the handlers below (flush before the error dialog)
  "OnUnhandledRejection",
  "LocalVariables",
  "ContextLines",
  "Screenshots",
  "Console",
  "ChildProcess", // added again below with PROCESS_EVENTS
]);

const state = {
  consent: false,
  asked: false,
  active: false,
  available: false,
  reason: "",
  settings: null,
  userData: "",
};

const rate = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
};

function buildInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "telemetry-build.json"), "utf8")) || {};
  } catch {
    return {};
  }
}

const automatedRun = (env) =>
  env.VERYNIZE_SKIP_ONBOARDING === "1" || env.VERYNIZE_BLOCK_PRODUCTION_CLOUD === "1" || !!env.CI;
const loopback = (host) => host === "localhost" || host === "[::1]" || host.startsWith("127.");

/** DSN, sample rates and environment, or {dsn: ""} with the reason reporting is unavailable. */
function resolveSettings(app, env = process.env) {
  const build = buildInfo();
  const dsn = String(env.SENTRY_DSN_DESKTOP || build.dsn || "").trim();
  const settings = {
    dsn: "",
    release: `verynize-desktop@${app.getVersion()}`,
    environment:
      env.SENTRY_ENVIRONMENT ||
      build.environment ||
      (app.isPackaged ? "production" : "development"),
    sampleRate: rate(env.SENTRY_SAMPLE_RATE ?? build.sampleRate, 1),
    tracesSampleRate: rate(env.SENTRY_TRACES_SAMPLE_RATE ?? build.tracesSampleRate, 0.05),
    tracePropagationOrigins: [],
  };
  if (!dsn) return { ...settings, reason: "not-configured" };
  let url;
  try {
    url = new URL(dsn);
  } catch {
    return { ...settings, reason: "invalid-dsn" };
  }
  if (!["http:", "https:"].includes(url.protocol)) return { ...settings, reason: "invalid-dsn" };
  if (automatedRun(env) && !loopback(url.hostname)) return { ...settings, reason: "automated-run" };
  try {
    settings.tracePropagationOrigins = [require("./cloud-defaults.cjs").cloudServerDefault(env)];
  } catch {}
  return { ...settings, dsn, reason: "" };
}

/** Whether the user ever answered (the settings toggle or the first-launch question). */
const answered = (userData) => fs.existsSync(path.join(userData, CONSENT_FILE));

function readConsent(userData) {
  try {
    return JSON.parse(fs.readFileSync(path.join(userData, CONSENT_FILE), "utf8")).enabled === true;
  } catch {
    return false;
  }
}

function writeConsent(userData, enabled) {
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, CONSENT_FILE);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ enabled, changedAt: new Date().toISOString() }));
  fs.renameSync(`${file}.tmp`, file);
}

/** ^origin(/|$) patterns: a plain string would match by substring (https://host.evil.example). */
const originPatterns = (origins) =>
  origins.map((origin) => new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/|$)`));

let Sentry = null;
const sendable = () => state.consent && state.active;

/** The process name a page's events carry: the editor, one of our internal windows, or untrusted. */
function rendererName(url) {
  // A window that has not loaded yet (no URL) is the editor being created: reports only come from a page that ran the preload.
  if (!url || require("./app-protocol.cjs").isAppURL(url)) return "renderer";
  try {
    return INTERNAL_PAGES[new URL(url).protocol] || UNTRUSTED;
  } catch {
    return UNTRUSTED;
  }
}

/** Events that may leave (before scrubbing): nothing from untrusted pages, no native dump of an internal window. */
function keepEvent(event) {
  const name = event?.tags?.["event.process"];
  if (name === UNTRUSTED) return false;
  if (
    Object.values(INTERNAL_PAGES).includes(name) &&
    event?.tags?.["event.environment"] === "native"
  )
    return false;
  return true;
}

// Which process was lost, for the event the SDK captures right after (its message names only process and reason).
function describeProcessLoss(Sentry, name, details) {
  Sentry.setContext("electron", {
    crashed_process: name,
    reason: details.reason,
    exit_code: details.exitCode,
  });
  setImmediate(() => Sentry.setContext("electron", null));
}

function initSdk(app, settings) {
  Sentry = require("@sentry/electron/main");
  const keep = (event) => sendable() && keepEvent(event);
  // Registered before Sentry.init, so they run before the SDK's own listeners capture the message.
  app.on("render-process-gone", (_event, contents, details) =>
    describeProcessLoss(Sentry, rendererName(contents.getURL()), details),
  );
  app.on("child-process-gone", (_event, details) =>
    describeProcessLoss(Sentry, details.type, details),
  );
  Sentry.init({
    dsn: settings.dsn,
    release: settings.release,
    environment: settings.environment,
    sampleRate: settings.sampleRate,
    tracesSampleRate: settings.tracesSampleRate,
    tracePropagationTargets: originPatterns(settings.tracePropagationOrigins),
    ipcMode: Sentry.IPCMode.Classic,
    // Only the editor page and our own render windows may report; anything else is tagged and dropped below.
    getRendererName: (contents) => rendererName(contents.getURL()),
    sendDefaultPii: false,
    dataCollection: scrub.DATA_COLLECTION,
    attachScreenshot: false,
    maxBreadcrumbs: 50,
    integrations: (defaults) => [
      ...defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name)),
      Sentry.childProcessIntegration({ events: PROCESS_EVENTS }),
    ],
    beforeBreadcrumb: (breadcrumb) => scrub.scrubBreadcrumb(breadcrumb),
    beforeSend: (event) => (keep(event) ? scrub.scrubEvent(event) : null),
    // Traces are streamed spans (beforeSendTransaction is ignored) and cannot be dropped here: gated by the transport.
    beforeSendSpan: (span) => scrub.scrubStreamedSpan(span),
    transportOptions: { shouldSend: () => sendable(), shouldStore: () => sendable() },
  });
  // Main-process data carries no account or machine identity; the platform and Electron versions come from contexts.
  Sentry.setUser(null);
  Sentry.setTag("surface", "desktop");
}

/** Report an error from the main process when reporting is on; always safe to call. */
function reportError(error, { fatal = false, mechanism = "generic" } = {}) {
  if (!Sentry || !sendable()) return;
  try {
    Sentry.captureException(error, {
      captureContext: { level: fatal ? "fatal" : "error" },
      mechanism: { type: mechanism, handled: false },
    });
  } catch {}
}

const flush = (timeout) =>
  Sentry && sendable() ? Sentry.flush(timeout).catch(() => false) : Promise.resolve(false);

function installProcessHandlers({ dialog }) {
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection in the main process:", reason);
    reportError(
      reason instanceof Error ? reason : new Error(`Unhandled rejection: ${String(reason)}`),
      {
        mechanism: "onunhandledrejection",
      },
    );
  });
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception in the main process:", error);
    reportError(error, { fatal: true, mechanism: "onuncaughtexception" });
    // Electron's default handler showed this dialog; keep it, after the report had a chance to leave.
    flush(2000).finally(() => {
      const stack = error?.stack || String(error);
      try {
        dialog?.showErrorBox(
          "A JavaScript error occurred in the main process",
          `Uncaught Exception:\n${stack}`,
        );
      } catch {}
    });
  });
}

/**
 * @param {import("electron").App} app
 * @param {{dialog?: import("electron").Dialog, env?: NodeJS.ProcessEnv}} [options]
 */
function start(app, { dialog, env = process.env } = {}) {
  installProcessHandlers({ dialog });
  state.userData = app.getPath("userData");
  state.consent = readConsent(state.userData);
  state.asked = answered(state.userData);
  state.settings = resolveSettings(app, env);
  state.available = !!state.settings.dsn;
  state.reason = state.settings.reason;
  if (!state.consent || !state.available) return state;
  // Home directory and account name are replaced wherever they appear (paths in messages and frames).
  try {
    scrub.setLiterals([os.homedir(), os.userInfo().username]);
  } catch {
    scrub.setLiterals([os.homedir()]);
  }
  try {
    initSdk(app, state.settings);
    state.active = true;
  } catch (error) {
    state.reason = "init-failed";
    console.error("Crash reporting could not start:", error?.message || error);
  }
  return state;
}

/** Renderer configuration for webPreferences.additionalArguments (no DSN: renderer events travel through main). */
function rendererArguments() {
  const settings = state.settings || {};
  const config = {
    enabled: sendable(),
    environment: settings.environment || "",
    release: settings.release || "",
    tracesSampleRate: settings.tracesSampleRate || 0,
    tracePropagationOrigins: settings.tracePropagationOrigins || [],
  };
  return [ARGUMENT + Buffer.from(JSON.stringify(config)).toString("base64")];
}

const status = () => ({
  enabled: state.consent,
  active: state.active,
  available: state.available,
  // On, but this launch started with it off: reports start after a restart.
  restartRequired: state.consent && state.available && !state.active,
  asked: state.asked,
});

function registerTelemetry(handle) {
  handle("telemetryGet", () => status());
  handle("telemetrySet", async (enabled) => {
    if (typeof enabled !== "boolean") throw Error("Invalid crash report setting");
    writeConsent(state.userData, enabled);
    state.consent = enabled;
    state.asked = true;
    if (!enabled && state.active) {
      state.active = false;
      await Sentry.close(2000).catch(() => false);
    }
    return status();
  });
}

module.exports = {
  ARGUMENT,
  start,
  rendererArguments,
  registerTelemetry,
  reportError,
  resolveSettings,
  readConsent,
  rendererName,
  keepEvent,
  PROCESS_EVENTS,
  status,
};
