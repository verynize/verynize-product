// Whole-page source round trips: document -> Tailwind JSX -> document and document -> HTML/CSS ->
// document. The JSX form is the codec's own serialization (classes + the data-vn side channel) with a
// header comment carrying the page and the document's variables; the HTML form is the canvas export
// with a class-based stylesheet (see export-code.mjs) and the importer in codec-html.mjs.
import { validateDocument } from "./design-store.mjs";
import { ensureShortIds, indexPage, getPage, createArtboards } from "./design-edit.mjs";
import { serializeNode } from "./jsx-codec.mjs";
import { exportHTML } from "./export-html.mjs";
import { cssCode } from "./export-code.mjs";
import { importHtml } from "./codec-html.mjs";

const clone = (value) => structuredClone(value);
export const SOURCE_HEADER = "@verynize";

/** Document-level state a page export needs to be read back: variables, aliases and page settings. */
export function sourceMeta(document, page) {
  const meta = { name: document.name, page: { name: page.name } };
  for (const key of ["width", "height", "background"])
    if (page[key] !== undefined) meta.page[key] = page[key];
  if (document.tokens && Object.keys(document.tokens).length) meta.tokens = document.tokens;
  if (document.variables && Object.keys(document.variables).length)
    meta.variables = document.variables;
  if (document.aliases && Object.keys(document.aliases).length) meta.aliases = document.aliases;
  return meta;
}

/** A blank version-2 document holding the variables and page settings of `meta`. */
export function documentFromMeta(meta = {}, fallbackName = "Imported") {
  const page = { id: "page-1", name: meta.page?.name || "Page", nodes: [] };
  for (const key of ["width", "height"])
    if (Number.isFinite(meta.page?.[key])) page[key] = meta.page[key];
  if (typeof meta.page?.background === "string") page.background = meta.page.background;
  const doc = {
    version: 2,
    name: typeof meta.name === "string" && meta.name.trim() ? meta.name : fallbackName,
    activePage: page.id,
    tokens: { ...meta.tokens },
    pages: [page],
  };
  if (meta.variables && typeof meta.variables === "object") doc.variables = clone(meta.variables);
  if (meta.aliases && typeof meta.aliases === "object") doc.aliases = clone(meta.aliases);
  return doc;
}

/**
 * Serialize every artboard of a page as Tailwind JSX. `full` (default) keeps embedded image sources
 * inline so nothing is elided; the header comment carries variables and page settings.
 */
export function documentToJsx(document, pageId, { full = true } = {}) {
  const d = clone(document);
  ensureShortIds(d);
  const page = getPage(d, pageId);
  const index = indexPage(page);
  const tokens = d.tokens || {};
  const body = index
    .children(null)
    .map((root) => serializeNode(root, index, { tokens, isRoot: true, full }))
    .join("\n");
  return `/* ${SOURCE_HEADER} ${JSON.stringify(sourceMeta(d, page)).replace(/\*\//g, "*\\/")} */\n${body}\n`;
}

/** Read the header comment written by documentToJsx (or null). */
export function readSourceHeader(code) {
  const m = String(code || "").match(/\/\*\s*@verynize\s+(\{[\s\S]*?\})\s*\*\//);
  if (!m) return null;
  try {
    return JSON.parse(m[1].replace(/\*\\\//g, "*/"));
  } catch {
    return null;
  }
}

/** The JSX body of codec source: header comment removed, a React component (tailwindCode) unwrapped. */
export function jsxBody(code) {
  let body = String(code).replace(/\/\*\s*@verynize\s+\{[\s\S]*?\}\s*\*\//, "");
  const component = body.match(
    /(?:export\s+default\s+)?function\s*[\w$]*\s*\([^)]*\)\s*\{\s*return\s*\(([\s\S]*)\)\s*;?\s*\}\s*$/,
  );
  // Canvas positions kept by the Code export (tailwindCode) as data-canvas-x/y.
  return (component ? component[1] : body).replace(
    / data-canvas-([xy])="/g,
    ' data-component-$1="',
  );
}

/**
 * Merge variables a source brings (tokens, typed variables, aliases) into `document` in place. Names the
 * document already defines keep their value; returns the names that were added.
 */
export function mergeVariables(document, { tokens = {}, variables = {}, aliases = {} } = {}) {
  const added = [];
  document.tokens ||= {};
  for (const [name, value] of Object.entries(tokens || {}))
    if (!Object.hasOwn(document.tokens, name) && !document.variables?.[name]) {
      document.tokens[name] = value;
      added.push(name);
    }
  for (const [name, value] of Object.entries(variables || {}))
    if (!Object.hasOwn(document.tokens, name) && !document.variables?.[name]) {
      (document.variables ||= {})[name] = structuredClone(value);
      added.push(name);
    }
  for (const [name, target] of Object.entries(aliases || {}))
    if (added.includes(name)) (document.aliases ||= {})[name] = target;
  return added;
}

/** Add the artboards of codec JSX (documentToJsx / tailwindCode / create_artboard JSX) to a page. */
export function importJsxInto(
  document,
  pageId,
  code,
  { viewport = null, name, placement = "preserve", split = "pages" } = {},
) {
  const doc = structuredClone(document);
  mergeVariables(doc, readSourceHeader(code) || {});
  const result = createArtboards(doc, pageId, jsxBody(code), {
    viewport,
    name,
    placement,
    importNames: true,
    split,
  });
  return {
    document: validateDocument(result.document),
    roots: result.roots,
    pages: result.pages,
    page: result.page,
    warnings: result.warnings,
  };
}

/** Parse JSX written by documentToJsx (or any codec JSX) into a new document. */
export function jsxToDocument(code, { viewport = null, name } = {}) {
  const meta = readSourceHeader(code) || {};
  const doc = documentFromMeta(meta, name || "Imported");
  validateDocument(doc);
  const result = createArtboards(doc, doc.activePage, jsxBody(code), { viewport });
  return { document: validateDocument(result.document), warnings: result.warnings };
}

/**
 * Import HTML into an existing page in two steps, so the slow part (stylesheets, cascade) runs outside a
 * document transaction: `prepare` resolves the HTML against the current document, `apply(document)`
 * adds the result to whatever the document is by then.
 */
export async function prepareHtmlImport(html, current, pageId, options = {}) {
  const result = await importHtml(html, { ...options, document: current, pageId });
  const imported = result.document;
  return {
    warnings: result.warnings,
    stats: result.stats,
    jsx: result.jsx,
    apply(document) {
      const doc = structuredClone(document);
      mergeVariables(doc, {
        tokens: imported.tokens,
        variables: imported.variables,
        aliases: imported.aliases,
      });
      const out = createArtboards(doc, pageId, result.jsx, {
        viewport: options.viewport || null,
        name: options.name,
        placement: options.placement || "auto",
        split: options.split || "pages",
      });
      for (const root of out.roots) {
        if (/^Imported page(?: \d+)?$/.test(root.name) && !options.name) {
          let n = 1;
          while (out.page.nodes.some((node) => node !== root && node.name === `Imported page ${n}`))
            n++;
          root.name = `Imported page ${n}`;
        }
      }
      return {
        document: validateDocument(out.document),
        roots: out.roots,
        pages: out.pages,
        page: out.page,
        warnings: out.warnings,
      };
    },
  };
}

/** HTML with a class-based stylesheet for a page (the canvas export), readable back by htmlToDocument. */
export function documentToHtml(document, pageId) {
  const page = getPage(document, pageId);
  return cssCode(exportHTML(document, page.id, { lossless: true }), document.tokens || {}, {
    document,
    pageId: page.id,
  });
}

/** Import HTML (a Verynize export or any page) into a new document. See importHtml for options. */
export async function htmlToDocument(html, options = {}) {
  const result = await importHtml(html, options);
  return {
    document: result.document,
    warnings: result.warnings,
    jsx: result.jsx,
    stats: result.stats,
  };
}
