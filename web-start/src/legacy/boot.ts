// Boots the desktop renderer (web/index.html) inside the Start document, in the browser only.
//
// The shell is generated from web/index.html at build time (web-start/build/legacy-web.mjs), so the
// markup and script order stay those of the desktop page. Order of work:
// 1. stylesheets, awaited, so legacy scripts measure a styled layout;
// 2. body markup, inserted before Start's own nodes as direct <body> children (legacy CSS and
//    selectors expect that);
// 3. scripts in document order (`async = false` keeps execution ordered while fetching in
//    parallel);
// 4. a DOMContentLoaded event. A parsed page fires it after its scripts; legacy listeners
//    registered during startup (cloud-panel.js reconnects the open file's room on it) need it.
//
// web/dist/ui.js is not loaded: at its place in the order the same UI runs from source, bundled into
// this app (legacy/ui.ts), so the islands and Start's routes share one React.
import shell from "virtual:verynize/legacy-shell";
import { loadLegacyUi } from "./ui";

/** The desktop UI bundle; on the web its source is part of Start's client build instead. */
const isUiBundle = (src: string | undefined) => !!src && /(^|\/)dist\/ui\.js(\?|$)/.test(src);
/** The desktop crash-report bootstrap (web/src/telemetry.ts); the web app starts its own SDK (../telemetry.ts). */
const isDesktopOnly = (src: string | undefined) =>
  !!src && /(^|\/)dist\/telemetry\.js(\?|$)/.test(src);

let booted: Promise<void> | undefined;
let styled: Promise<void> | undefined;

/** Starts the legacy editor once per page. Later calls return the same promise. */
export function bootLegacyEditor(): Promise<void> {
  booted ??= run();
  return booted;
}

const loaded = (element: HTMLLinkElement | HTMLScriptElement, label: string) =>
  new Promise<void>((resolve, reject) => {
    element.addEventListener("load", () => resolve(), { once: true });
    element.addEventListener("error", () => reject(new Error(`Failed to load ${label}`)), {
      once: true,
    });
  });

/**
 * Step 1 alone: the stylesheets of web/index.html (web/dist/ui.css included), once per page. The sign-in screen shown
 * before the editor boots (routes/_editor.tsx) uses them too.
 */
export function loadLegacyStyles(): Promise<void> {
  styled ??= styles();
  return styled;
}

async function styles() {
  if (shell.title) document.title = shell.title;
  const styles: Promise<void>[] = [];
  for (const style of shell.styles) {
    if (style.href === undefined) {
      const element = document.createElement("style");
      element.textContent = style.text ?? "";
      document.head.append(element);
      continue;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = shell.assetUrls[style.href] ?? style.href;
    styles.push(loaded(link, style.href).catch((error: Error) => console.error(error.message)));
    document.head.append(link);
  }
  await Promise.all(styles);
}

async function run() {
  const root = document.documentElement;
  root.dataset.legacyEditor = "booting";
  await loadLegacyStyles();

  for (const [name, value] of Object.entries(shell.bodyAttributes))
    document.body.setAttribute(name, value);
  const template = document.createElement("template");
  template.innerHTML = shell.bodyHtml;
  document.body.prepend(template.content);

  let last: Promise<void> = Promise.resolve();
  let afterUi = false;
  for (const script of shell.scripts) {
    if (isDesktopOnly(script.attrs.src)) continue;
    if (isUiBundle(script.attrs.src)) {
      // Runs after the scripts before it, like the ordered script it replaces.
      last = last.then(loadLegacyUi).then(
        () => undefined,
        (error: Error) => console.error(error),
      );
      afterUi = true;
      continue;
    }
    // Inserted scripts only keep their order among themselves: anything after the UI waits for it.
    if (afterUi) await last;
    const element = document.createElement("script");
    for (const [name, value] of Object.entries(script.attrs)) element.setAttribute(name, value);
    if (script.attrs.src) element.src = shell.assetUrls[script.attrs.src] ?? script.attrs.src;
    element.async = false;
    if (script.text !== undefined) {
      // Inserted inline scripts run immediately, so wait for the scripts before them.
      await last;
      element.text = script.text;
    } else
      last = loaded(element, script.attrs.src ?? "script").catch((error: Error) =>
        console.error(error.message),
      );
    document.body.append(element);
  }
  // Ordered scripts run in insertion order, so the last one loading means all have run.
  await last;
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  root.dataset.legacyEditor = "ready";
}
