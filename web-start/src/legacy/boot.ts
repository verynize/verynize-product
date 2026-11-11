// Both phases derive their ordered assets from web/index.html. Desktop still loads that page
// normally; only the Start host interprets data-boot="home".
import shell from "virtual:verynize/legacy-shell";
import { loadLegacyUi, prefetchLegacyUi } from "./ui";
import { loadHomeUi } from "./home-ui";

const isUiBundle = (src: string | undefined) => !!src && /(^|\/)dist\/ui\.js(\?|$)/.test(src);
const isDesktopOnly = (src: string | undefined) =>
  !!src && /(^|\/)dist\/telemetry\.js(\?|$)/.test(src);
let home: Promise<void> | undefined;
let editor: Promise<void> | undefined;
const stylesheets = new Map<object, Promise<void>>();
const scripts = new Set<object>();
const styleElements = new Map<object, HTMLElement>();
let inserted = false;
let prefetched = false;

const loaded = (element: HTMLLinkElement | HTMLScriptElement, label: string) =>
  new Promise<void>((resolve, reject) => {
    element.addEventListener("load", () => resolve(), { once: true });
    element.addEventListener("error", () => reject(new Error(`Failed to load ${label}`)), {
      once: true,
    });
  });

/** Sign-in and Home need only the shared tokens/island CSS. */
export async function loadLegacyStyles(editor = false): Promise<void> {
  if (shell.title) document.title = shell.title;
  await Promise.all(
    shell.styles
      .filter((style) => editor || style.boot === "home")
      .map((style) => {
        let pending = stylesheets.get(style);
        if (!pending) {
          if (style.href === undefined) {
            const element = document.createElement("style");
            element.textContent = style.text ?? "";
            document.head.append(element);
            pending = Promise.resolve();
          } else {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = style.href;
            pending = loaded(link, style.href);
            const next = shell.styles
              .slice(shell.styles.indexOf(style) + 1)
              .map((item) => styleElements.get(item))
              .find(Boolean);
            document.head.insertBefore(link, next ?? null);
            styleElements.set(style, link);
          }
          stylesheets.set(style, pending);
        }
        return pending;
      }),
  );
}

function insertShell() {
  if (inserted) return;
  inserted = true;
  for (const [name, value] of Object.entries(shell.bodyAttributes))
    document.body.setAttribute(name, value);
  const template = document.createElement("template");
  template.innerHTML = shell.bodyHtml;
  document.body.prepend(template.content);
}

async function runScripts(homeOnly: boolean) {
  // Dynamic classic scripts retain document order while their downloads overlap.
  const pending: Promise<void>[] = [];
  for (const script of shell.scripts) {
    if (scripts.has(script) || isDesktopOnly(script.attrs.src) || isUiBundle(script.attrs.src))
      continue;
    if (homeOnly && script.attrs["data-boot"] !== "home") continue;
    const element = document.createElement("script");
    for (const [name, value] of Object.entries(script.attrs)) element.setAttribute(name, value);
    element.async = false;
    if (script.text !== undefined) {
      await Promise.all(pending);
      element.text = script.text;
    } else pending.push(loaded(element, script.attrs.src ?? "script"));
    scripts.add(script);
    document.body.append(element);
  }
  await Promise.all(pending);
}

export function bootLegacyHome(): Promise<void> {
  // A direct editor launch may redirect to Files before the islands commit. Let its
  // existing route UI finish; starting a Home phase here would hide unclaimed controls.
  if (editor) return editor;
  window.verynizeEditorBoot = bootLegacyEditor;
  home ??= (async () => {
    await loadLegacyStyles();
    insertShell();
    document.documentElement.dataset.legacyHome = "booting";
    document.body.classList.add("files-view");
    await runScripts(true);
    await loadHomeUi();
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    document.documentElement.dataset.legacyHome = "ready";
  })();
  return home;
}

/** The existing library, account and shell survive every route transition. */
export function bootLegacyEditor(): Promise<void> {
  window.verynizeEditorBoot = bootLegacyEditor;
  editor ??= (async () => {
    if (home) await home;
    document.documentElement.dataset.legacyEditor = "booting";
    await loadLegacyStyles(true);
    insertShell();
    await runScripts(false);
    window.dispatchEvent(new Event("verynize:editor-started"));
    await loadLegacyUi();
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    document.documentElement.dataset.legacyEditor = "ready";
  })();
  return editor;
}

/** Warm the HTTP cache, without evaluating scripts, mounting islands or starting a document. */
export function prefetchLegacyEditor() {
  if (prefetched || editor) return;
  prefetched = true;
  void prefetchLegacyUi()
    .then(({ editorIslandUrl }) => {
      const link = document.createElement("link");
      link.rel = "modulepreload";
      link.dataset.editorPrefetch = "true";
      link.addEventListener(
        "load",
        () => {
          link.dataset.loaded = "true";
        },
        { once: true },
      );
      link.href = editorIslandUrl;
      document.head.append(link);
    })
    .catch(console.error);
  const assets = [
    ...shell.scripts
      .filter(
        (script) =>
          script.attrs["data-boot"] !== "home" &&
          !isDesktopOnly(script.attrs.src) &&
          !isUiBundle(script.attrs.src),
      )
      .map((script) => ({ url: script.attrs.src, as: "script" })),
    ...shell.styles
      .filter((style) => style.boot !== "home")
      .map((style) => ({ url: style.href, as: "style" })),
  ];
  for (const { url, as } of assets) {
    if (!url) continue;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = as;
    link.href = url;
    document.head.append(link);
  }
}

export function scheduleEditorPrefetch() {
  const hover = (event: Event) => {
    if ((event.target as Element | null)?.closest?.(".file-card, .file-open, #library-new-file"))
      prefetchLegacyEditor();
  };
  document.addEventListener("pointerover", hover, { passive: true });
  document.addEventListener("pointerdown", hover, { passive: true });
  // Leave first paint, file-list fetching and input ahead of the background downloads.
  const timer = setTimeout(() => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(prefetchLegacyEditor);
    else prefetchLegacyEditor();
  }, 1500);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("pointerover", hover);
    document.removeEventListener("pointerdown", hover);
  };
}
