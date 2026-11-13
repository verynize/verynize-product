// The editor page is served from a privileged custom scheme, app://verynize/, instead of file://
// (Electron security checklist #17/#18). The handler only serves files inside web/, and IPC trust is
// decided by the sender's origin, so the renderer may change its path, query and hash freely
// (client-side routes such as app://verynize/editor).
//
//   registerSchemes(protocol)        before app ready
//   registerHandler(protocol)        after app ready (default session)
//   isTrustedSender(event, win)      IPC guard: win's main frame showing an app://verynize page
//   isAppURL(url)                    same-origin check for navigation guards
//   resolveRequest(url)              {status, file?} for a request URL (exported for tests)
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCHEME = "app";
const HOST = "verynize";
const ORIGIN = `${SCHEME}://${HOST}`;
// Plain launches open Files; explicit editor URLs are still handled by the shell router.
const ENTRY_URL = `${ORIGIN}/`;
const WEB_ROOT = path.resolve(__dirname, "../web");
const INDEX = path.join(WEB_ROOT, "index.html");

const PRIVILEGES = {
  standard: true, // origin, relative URLs and localStorage behave like http(s)
  secure: true, // secure context (clipboard, crypto.subtle, no mixed-content downgrade)
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
  codeCache: true, // V8 code cache for the large bundles (web/dist/ui.js, app.js)
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function registerSchemes(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: PRIVILEGES },
    {
      scheme: "asset",
      privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false },
    },
    {
      scheme: "verynize-render",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** True for app://verynize/... (no credentials, no port). Node's URL reports origin "null" for
 *  non-special schemes, so protocol and host are compared instead of `.origin`. */
function isAppURL(value) {
  if (typeof value !== "string" || !value) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === SCHEME + ":" && url.host === HOST && !url.username && !url.password;
}

/** IPC guard: the event comes from `win`'s own main frame and that frame shows an app://verynize page. */
function isTrustedSender(event, win) {
  try {
    if (!event || !win || win.isDestroyed() || event.sender !== win.webContents) return false;
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || frame.detached) return false;
    // WebFrameMain.origin is Chromium's serialized origin ("app://verynize" for the standard scheme);
    // about:blank, data: and opaque frames never match it.
    return frame.origin === ORIGIN && isAppURL(frame.url);
  } catch {
    return false;
  }
}

const within = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
};
let realRoot = null;

/** Maps a request URL to a file in web/: {status:200,file} or {status:4xx}. Never follows a symlink
 *  out of web/. Extensionless paths are client-side routes and get index.html, whatever their segments
 *  hold besides separators and dot segments: a cloud file's route is /editor/room%3A<id>, and refusing
 *  its colon showed "Forbidden" on every reload of a shared file. */
async function resolveRequest(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { status: 400 };
  }
  if (url.protocol !== SCHEME + ":" || url.host !== HOST || url.username || url.password)
    return { status: 404 };
  // The URL parser already removed literal and %2e dot segments; decode each segment ourselves so an
  // encoded separator (%2f, %5c) or NUL can never become part of the file path.
  const segments = [];
  for (const raw of url.pathname.split("/")) {
    if (!raw) continue;
    let segment;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return { status: 400 };
    }
    if (segment === "." || segment === ".." || /[\\/\0]/.test(segment)) return { status: 403 };
    if (segment.startsWith(".")) return { status: 404 }; // no dotfiles
    segments.push(segment);
  }
  const last = segments[segments.length - 1] || "";
  if (!segments.length || !path.extname(last))
    return { status: 200, file: INDEX, fallback: segments.length > 0 };
  // A file path never holds a colon (Windows drive letters, NTFS streams).
  if (segments.some((segment) => segment.includes(":"))) return { status: 403 };
  const file = path.resolve(WEB_ROOT, ...segments);
  if (!within(WEB_ROOT, file)) return { status: 403 };
  let real;
  try {
    realRoot ||= await fsp.realpath(WEB_ROOT);
    real = await fsp.realpath(file);
  } catch {
    return { status: 404 };
  }
  if (!within(realRoot, real)) return { status: 403 }; // symlink escaping web/
  try {
    if (!(await fsp.stat(real)).isFile()) return { status: 404 };
  } catch {
    return { status: 404 };
  }
  return { status: 200, file: real };
}

const HEADERS = { "cache-control": "no-cache", "x-content-type-options": "nosniff" };
const text = (status, body) =>
  new Response(body, {
    status,
    headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" },
  });

const readBody = (file) => fsp.readFile(file);

async function serve(request, { load = readBody } = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method not allowed");
  const result = await resolveRequest(request.url);
  if (result.status !== 200)
    return text(
      result.status,
      result.status === 404 ? "Not found" : result.status === 403 ? "Forbidden" : "Bad request",
    );
  const type = MIME[path.extname(result.file).toLowerCase()] || "application/octet-stream";
  try {
    const body = request.method === "HEAD" ? null : await load(result.file);
    return new Response(body, { status: 200, headers: { ...HEADERS, "content-type": type } });
  } catch {
    return text(404, "Not found");
  }
}

// In Electron, stream files through Chromium's file loader (net.fetch) instead of buffering each one in
// the main process: the renderer's scripts load as fast as file:// did.
function registerHandler(protocol, net) {
  const load = net
    ? async (file) => {
        const res = await net.fetch(pathToFileURL(file).href);
        if (!res.ok) throw Error("unreadable");
        return res.body;
      }
    : readBody;
  protocol.handle(SCHEME, (request) =>
    serve(request, { load }).catch(() => text(500, "Internal error")),
  );
}

module.exports = {
  SCHEME,
  HOST,
  ORIGIN,
  ENTRY_URL,
  WEB_ROOT,
  PRIVILEGES,
  registerSchemes,
  registerHandler,
  isTrustedSender,
  isAppURL,
  resolveRequest,
  serve,
};
