// Vite plugin that lets the TanStack Start web app reuse the desktop renderer without forking it.
//
// - `virtual:verynize/legacy-shell` is generated from web/index.html: its stylesheets, body markup
//   and scripts in document order. The editor routes boot exactly that page client-side
//   (web-start/src/legacy/boot.ts), so editing web/index.html changes desktop and web together.
// - Static files come from web/ through an allowlist: everything except web/src (sources),
//   web/index.html (Start renders the document) and desktop-only pages. Served by a dev middleware
//   and emitted into the client build, replacing the old `publicDir: "web"`.
// - `virtual:verynize/legacy-ui` is the renderer UI (web/src/web-app.tsx: every island of
//   web/dist/ui.js plus the area components Start's routes render), bundled into Start's client
//   build from source so the page has one React, one QueryClient and one TanStack Router copy.
//   The server build gets an empty module: the editor is client-only. Styles still come from
//   web/dist/ui.css (built by scripts/build-ui.cjs with Tailwind), so CSS imported under web/src is
//   an empty module here and the web and desktop pages load the same stylesheet.
// - With `staticHeaders`, the client build also gets Cloudflare's `_headers`: Vite's content-hashed
//   `/assets/<name>-<hash>.*` never change, so browsers keep them for a year without asking again.
//   Fixed names (`/app.js`, `/style.css`, fonts under `/assets/fonts/`) keep the default revalidation.
import fs from "node:fs";
import path from "node:path";

const VIRTUAL_ID = "virtual:verynize/legacy-shell";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const UI_ID = "virtual:verynize/legacy-ui";
const RESOLVED_UI_ID = "\0" + UI_ID;
const EMPTY_CSS_ID = "\0verynize:ui-css";

/**
 * Paths under web/ that are never published to the browser deployment. web/dist only ships the
 * combined bundle (single-island development builds stay local).
 */
const EXCLUDED = [
  /^src\//,
  /^index\.html$/,
  /^storage-migration\.html$/,
  /^dist\/(?!ui\.(js|css)$)/,
  /(^|\/)\./,
  /\.md$/,
];

export function isPublicWebFile(relative) {
  return !EXCLUDED.some((pattern) => pattern.test(relative));
}

/** Every publishable file under `webDir`, as posix paths relative to it. */
export function publicWebFiles(webDir) {
  return fs
    .readdirSync(webDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(webDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .filter(isPublicWebFile)
    .sort();
}

const attributes = (source) =>
  Object.fromEntries(
    [...source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [
      m[1].toLowerCase(),
      m[2] ?? m[3] ?? m[4] ?? "",
    ]),
  );

/**
 * Split web/index.html into the parts the client boot needs. Scripts are collected from the whole
 * document in order (a script added to <head> still runs before the body scripts).
 */
export function parseLegacyShell(html) {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error("web/index.html has no <body>");
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attributes(match[1]);
    scripts.push(attrs.src ? { attrs } : { attrs, text: match[2] });
  }
  const styles = [];
  for (const match of head.matchAll(/<link\b([^>]*)>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (match[2] !== undefined) styles.push({ text: match[2] });
    else {
      const attrs = attributes(match[1]);
      if (attrs.rel === "stylesheet" && attrs.href) styles.push({ href: attrs.href });
    }
  }
  return {
    title: head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].trim() ?? "",
    styles,
    bodyAttributes: attributes(bodyMatch[1]),
    bodyHtml: bodyMatch[2].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""),
    scripts,
  };
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".html": "text/html; charset=utf-8",
};

export function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * The renderer UI from source (`virtual:verynize/legacy-ui`): the `@` alias of web/src, the entry
 * on the client and an empty module on the server, and CSS imports under web/src emptied (the page
 * loads web/dist/ui.css, see above).
 * @param {{ webDir: string }} options
 */
function legacyUi({ webDir }) {
  const srcDir = path.join(webDir, "src");
  const entry = path.join(srcDir, "web-app.tsx").split(path.sep).join("/");
  return {
    name: "verynize:legacy-ui",
    enforce: "pre",
    config: () => ({ resolve: { alias: { "@": srcDir } } }),
    resolveId(id, importer) {
      if (id === UI_ID) return RESOLVED_UI_ID;
      if (
        importer &&
        path.resolve(importer.split("?")[0]).startsWith(srcDir + path.sep) &&
        /\.css(\?|$)/.test(id)
      )
        return EMPTY_CSS_ID;
    },
    load(id) {
      if (id === EMPTY_CSS_ID) return "";
      if (id !== RESOLVED_UI_ID) return;
      return this.environment?.name === "client"
        ? `export * from ${JSON.stringify(entry)};`
        : "export {};";
    },
  };
}

/** `_headers` of the Cloudflare static assets (one path segment: `:file` never matches a `/`). */
export const STATIC_HEADERS = `/assets/:file
  Cache-Control: public, max-age=31536000, immutable
`;
/** Public web/ files the immutable rule would match: their names never change, so they must not. */
const HASHED_ONLY = /^assets\/[^/]+$/;

/** @param {{ webDir: string, staticHeaders?: boolean }} options */
export function legacyWeb({ webDir, staticHeaders = false }) {
  return [legacyUi({ webDir }), legacyWebFiles({ webDir, staticHeaders })];
}

/** @param {{ webDir: string, staticHeaders: boolean }} options */
function legacyWebFiles({ webDir, staticHeaders }) {
  const indexHtml = path.join(webDir, "index.html");
  return {
    name: "verynize:legacy-web",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      this.addWatchFile(indexHtml);
      return `export default ${JSON.stringify(parseLegacyShell(fs.readFileSync(indexHtml, "utf8")))};`;
    },
    configureServer(server) {
      server.watcher.add(indexHtml);
      server.watcher.on("change", (file) => {
        if (path.resolve(file) !== indexHtml) return;
        for (const environment of Object.values(server.environments)) {
          const module = environment.moduleGraph.getModuleById(RESOLVED_ID);
          if (module) environment.moduleGraph.invalidateModule(module);
        }
      });
      // Serve allowlisted web/ files before Start's request handler sees the request.
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        let relative;
        try {
          relative = decodeURIComponent(new URL(req.url, "http://local").pathname).slice(1);
        } catch {
          return next();
        }
        const file = path.join(webDir, relative);
        if (!relative || !file.startsWith(webDir + path.sep) || !isPublicWebFile(relative))
          return next();
        fs.stat(file, (error, stat) => {
          if (error || !stat.isFile()) return next();
          res.setHeader("content-type", contentType(file));
          res.setHeader("content-length", stat.size);
          res.setHeader("cache-control", "no-cache");
          if (req.method === "HEAD") return res.end();
          fs.createReadStream(file).pipe(res);
        });
      });
    },
    buildStart() {
      if (this.environment?.name !== "client") return;
      if (!fs.existsSync(path.join(webDir, "dist", "ui.js")))
        this.warn("web/dist/ui.js is missing: run `npm run build:ui` before building the web app.");
    },
    generateBundle() {
      if (this.environment?.name !== "client") return;
      for (const fileName of publicWebFiles(webDir)) {
        if (staticHeaders && HASHED_ONLY.test(fileName))
          this.error(`web/${fileName} would be cached as immutable: move it out of web/assets/.`);
        this.emitFile({
          type: "asset",
          fileName,
          source: fs.readFileSync(path.join(webDir, fileName)),
        });
      }
      if (staticHeaders)
        this.emitFile({ type: "asset", fileName: "_headers", source: STATIC_HEADERS });
    },
  };
}
