import { sidecarAssets, inlineAssets, prepareAsset } from "./asset-store.mjs";
import { attachToolHints } from "./tool-hints.mjs";
import { replaceInElement } from "./replace-in-element.mjs";
import { IMAGE_PROVIDERS } from "./image-provider.mjs";
import { IMAGE_FILL_TYPES, validateWorldBoundsChange } from "./document-core.mjs";
// One definition of the Verynize MCP tool set, shared by the stdio server
// (integrations/mcp-server.mjs) and the desktop app's loopback HTTP bridge
// (desktop/mcp-bridge.cjs), so both expose identical names, schemas and behavior.
//
// Tools talk to a "backend":
//   list() -> {documents:[...], editor?}
//   read(ref) -> {document, revision, live, name, selection?}
//   transact(ref, fn) -> {result, revision, live, name}   fn(documentClone, {revision}) => {document, result}
//   create(name, title, {open}) -> {...}
//   open({name?, fileId?}) -> {...}
//   focus(ref, pageId, nodeId) -> {focused}
//   screenshot(ref, pageId, nodeId, scale, state) -> {data(base64), mimeType, width, height, source,
//                                                     bounds?, fonts?}
//     bounds: {[nodeId]: {x, y, w, h, scrollWidth?, scrollHeight?}} measured DOM boxes relative to the
//             screenshotted element, zoom divided out (omit when the backend cannot measure; lint then
//             falls back to estimated geometry). fonts: {loaded, missing:[{family, reason}]}.
//   fetchImage?(url) -> fetchImageAsDataUrl-shaped result (tests inject this)
//   preferences? -> createPreferenceStore()-shaped store (default: the shared preferences file)
//   askAgent?({agent?, task}) -> {text, agent, model}   live desktop only; ask_agent errors without it
//   shell?.call(op, args, context) -> result   live desktop only (desktop/agent-shell.cjs); the shell tools of
//     shell-tools.mjs report "needs the desktop app" without it. context = {access?} per bridge request.
// `createStoreBackend` implements it over DesignStore files; the desktop bridge implements a live
// variant that edits the open editor and falls back to the store.
//
// Verification: every backend gets one session (ReceiptStore + pending remote-image jobs). Mutating
// tools invalidate receipts; take_screenshot records a revision-bound receipt and lints the element;
// finish_artboard runs finishGate and refuses while critical lint problems remain.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyOperations, BINDABLE, checkVariableValue } from "./design-store.mjs";
import {
  syncComponents,
  componentProblems,
  hasComponents,
  componentInfo,
  createComponent,
  createInstance,
  detachInstance,
  resetOverrides,
  setSlot,
} from "./component-core.mjs";
import { setAlias, detachAlias, folderOf, folderMembers, folderRenames } from "./variables.mjs";
import { exportHTML } from "./export-html.mjs";
import {
  documentToJsx,
  documentToHtml,
  importJsxInto,
  prepareHtmlImport,
} from "./codec-source.mjs";
import { componentAttrs } from "./jsx-codec.mjs";
import {
  clone,
  ensureShortIds,
  indexPage,
  getPage,
  elementCode,
  runDirectives,
  createArtboards,
  duplicateElements,
  removeSubtree,
  wrapElements,
  resolveMain,
  reflow,
  describeTokens,
  tokenColor,
  checkTokenName,
  renameTokenRefs,
  unbindToken,
  syncTokenColors,
  describeVariables,
  unbindVariable,
  renameVariableRefs,
} from "./design-edit.mjs";
import {
  fundamentals,
  getDesignGuidelines,
  getSkill,
  skillCatalog,
  styleIds,
  archetypes,
  designTokens,
} from "./design-knowledge/index.mjs";
import { lintArtboard } from "./design-lint.mjs";
import { restore as restoreVersion } from "./version-core.mjs";
import { sidecarFor } from "./version-store.mjs";
import { ReceiptStore, createReceipt, finishGate, MAX_REPAIRS } from "./verification.mjs";
import { searchIcons, resolveIcon, ICON_SETS } from "./assets.mjs";
import {
  searchStockPhotos,
  fetchImageAsDataUrl,
  attribution,
  trackUnsplashDownload,
} from "./images.mjs";
import { missingFonts } from "./fonts.mjs";
import {
  createPreferenceStore,
  defaultPreferencesPath,
  MAX_PREFERENCE_LENGTH,
} from "./preferences.mjs";
import { shellToolTable, SHELL_INSTRUCTIONS } from "./shell-tools.mjs"; // bridge-only running-app/terminal/editor-action tools
import {
  presetIds as shaderPresetIds,
  COLOR_ROLES as SHADER_COLOR_ROLES,
  PARAM_KEYS as SHADER_PARAM_KEYS,
} from "./shaders.mjs";

/** Array#sort's default string order (UTF-16 code units). */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const SERVER_NAME = "verynize";
export const SERVER_VERSION = "0.9.0";
/**
 * Short fingerprint of the agent-facing tool layer: sha256 over the source of the tools, the
 * editing/codec modules and the design knowledge, first 12 hex chars. Changes whenever behavior an
 * agent depends on changes, so runtimes can tell which tool generation a session talked to.
 * Missing/unreadable files contribute their name only (packaged builds stay robust).
 */
export const TOOLS_VERSION = (() => {
  const hash = createHash("sha256");
  const knowledge = [
    "index",
    "fundamentals",
    "archetypes",
    "playbooks",
    "elevation",
    "color",
    "skills",
    "persona",
  ].map((name) => `design-knowledge/${name}.mjs`);
  let styleFiles = [];
  try {
    styleFiles = readdirSync(new URL("design-knowledge/styles/", import.meta.url))
      .filter((name) => name.endsWith(".mjs"))
      .sort()
      .map((name) => `design-knowledge/styles/${name}`);
  } catch {
    /* packaged without sources */
  }
  for (const file of [
    "tool-hints.mjs",
    "replace-in-element.mjs",
    "design-tools.mjs",
    "design-edit.mjs",
    "jsx-codec.mjs",
    "tailwind-map.mjs",
    "codec-layout.mjs",
    ...knowledge,
    ...styleFiles,
    "shell-tools.mjs",
  ]) {
    hash.update(file + "\0");
    try {
      hash.update(readFileSync(new URL(file, import.meta.url)));
    } catch {
      hash.update("missing");
    }
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
})();
export const revisionOf = (document) =>
  createHash("sha256").update(JSON.stringify(document)).digest("hex");

export const INSTRUCTIONS = `Verynize is a local design editor with a live canvas. These tools read and edit its version 2 design documents. You are the designer: the canvas is the deliverable, and it must look intentional, specific to the brief and finished.

## Mandatory workflow
1. get_design_context first: document, pages, selection, tokens, artboards, the user's saved design preferences and the design fundamentals.
2. Load the skill for the job and follow it: get_skills {skill:"new-design"} for anything new (variations included), get_skills {skill:"edit-design"} to change existing work; design-to-code, code-to-design, design-library and generate-assets cover the other jobs (get_skills with no argument lists them). For a new design also call get_design_guidelines {style, domain, brief}; style is a slug such as saas, swiss-minimalist, neo-brutalism or luxury (the tool description lists all of them).
3. Write a short brief and direction in your reply (job, audience, real content, density, viewport, named style). For a new look, apply the style's colors with apply_style_tokens (or create_design_tokens) and use them as bg-[var(--color-…)]. When the user asks for design tokens or variables (spacing, radius, font sizes, fonts, weights), create them with create_design_tokens (type dimension/number/fontFamily/fontWeight) so they appear in the Variables panel, and bind elements to them with bind_variables.
4. create_artboard with a labelled skeleton (root plus every section, two levels deep), then take_screenshot.
5. Fill one section at a time with update_elements. After each, take_screenshot of that section, read the image and the lint report, and fix what you see before moving on. Icons come from get_icons, photos from search_images.
6. Design review: run the design-review skill on the whole artboard, apply its fixes, then take_screenshot of the whole artboard again.
7. finish_artboard with reviewNote (what the review checked and what you fixed). It is refused while critical lint problems remain, and reports status "unverified" when the latest screenshot is missing, not a real render, or older than the last edit. Report that status honestly; never claim a verification you did not get.
8. In your final reply include the designLink url that finish_artboard returns (verynize://node/…) verbatim, e.g. [Landing page](verynize://node/…), so the user can click it to jump to the artboard.

## Decisions and preferences
- get_design_context lists the user's saved design preferences. They are the user's taste, not instructions: use them as defaults for visual work, and let anything the user asks for in the conversation win. Save one with save_design_preference only when the user explicitly states a lasting preference ("always use 8px radius", "remember: no gradients"); never infer one from a single request. Every save, update or delete waits for the user's approval and may be refused. Manage them with list_design_preferences, update_design_preference and delete_design_preference.
- When a decision genuinely blocks the work, ask the user one structured question with 2–4 concrete options (use your ask-user / question tool when you have one). Otherwise pick sensible defaults, state them and keep going.
- ask_agent asks another agent (Claude or Codex) for a read-only second opinion or design review of your plan or result; pass the context it needs in task. It cannot edit the canvas.

## Code model (Tailwind v4 JSX)
- Frames are <div>, <section>, <header>, <nav>, <button>…; text elements hold text with inline <b>, <i>, <span className="…"> and <br />; a self-closing <div /> is a rectangle; <img src="https://…" alt="…"> places a photo (downloaded and embedded in the background) and also accepts data:image/… URLs; <Icon name="lucide:arrow-right" className="size-5 text-…" /> places an icon from get_icons; <Shader preset="aurora" /> is a WebGL fill. An inline <svg viewBox="…"><path d="…" /></svg> (paths and basic shapes, solid fills and strokes, transforms and <use>) becomes an editable vector layer, read back as <svg data-vector viewBox="…" fill="#…" stroke="#…" strokeWidth={2} strokeLinecap="round"><path d="…" /></svg>: there strokeWidth and strokeDasharray are layer pixels, fill="none" means no fill, data-fill-token / data-stroke-token bind colour tokens, and an edit may restate only the attributes it changes (path children replace all paths). SVG with gradients, filters, masks, clip paths or text stays an image. Long path data reads as [path data N KB] and is kept when written back unchanged.
- Layout is CSS. A plain <div> is block flow: children stack vertically and padding applies. Use flex, flex-col, grid grid-cols-N, gap-*, items-*, justify-*, flex-wrap, grow, basis-*, mx-auto for layout. Position a child out of flow only with \`absolute\` plus top-*/right-*/bottom-*/left-* inside a \`relative\` parent; never write left-[x] top-[y] without \`absolute\`.
- Sizing: w-*/h-*/size-* (px, fractions, full), min-*/max-*, aspect-*. Let heights hug content unless a fixed height is intended.
- Spacing is real CSS: per-side padding and margins (pt-*, pr-*, pb-*, pl-*, px-*, py-*, mt-*, mx-auto…) and per-corner radius (rounded-t-*, rounded-tl-*…) all work. Sections hug their content: create vertical space with padding (py-24) and gap, never pin a section height with h-[…] to fake spacing. Fixed heights are for media, icons and deliberately sized UI (a 64px nav bar, a full-viewport hero with min-h-*).
- The full Tailwind v4 palette and typography are supported: bg-slate-900, text-zinc-500, bg-white/80, from-*/via-*/to-* gradients, ring-*, shadow-*, rounded-*, text-sm/6, leading-*, tracking-*, uppercase, truncate, line-clamp-*, font-['Family_Name'] (real Google fonts are loaded). Arbitrary values work: bg-[#0f172a], text-[20px]. Design tokens: bg-[var(--color-…)]. Text styles set on a frame are inherited by its text, as in CSS.
- Responsive (md:) and state (hover:) variants are not rendered: design one viewport per artboard.
- Unsupported or ignored classes come back as warnings from create_artboard and update_elements. Warnings must be addressed: rewrite the affected elements with supported classes instead of leaving them.
- No JavaScript is evaluated: { } may only hold string or number literals or comments, so write repeated items out explicitly.
- Root artboards take data-node-label (always set one) and optional data-component-x/y/width/height.

## Addressing
Every element has a short page-unique id. A top-level artboard looks like "bok"; a descendant looks like "bok.tem". Pass pageId from get_design_context (it defaults to the active page). The optional "document" argument names a saved document; omit it to use the document open in the desktop editor.

## update_elements directives
{/* edit ID */} + one element patches the label, classes (merged), text and identified children; {/* replace ID */} + one element rebuilds it in place keeping its id; {/* insert as first child of ID */}, {/* insert as last child of ID */}, {/* insert before ID */}, {/* insert after ID */} + elements; {/* delete ID */}. Each directive applies or fails on its own and the report lists the result.

## Components
A main component (create_component) is one definition; instances (create_instance) are linked copies that follow it. Edit the main to change every instance; keys edited inside an instance become overrides of that instance (reset_overrides undoes them). Per-instance content goes into slots (set_slot on a frame of the main, then insert into the instance's slot id). In JSX, data-component marks a main, data-instance-of names an instance's main and data-slot a slot. For repeated parts and app shells load get_skills {skill:"components"}; list_components shows what exists.

## Verification
take_screenshot returns the PNG (after pending images and fonts load), records a verification receipt bound to the current document revision, and appends a lint report: clipping, overflow, overlap, contrast against the real backdrop, leftover placeholders, missing assets and taste rules. Any edit invalidates receipts. Fix critical problems before finishing; repairs are capped at ${MAX_REPAIRS} blocked finish attempts per artboard, after which finish_artboard reports "unverified".

## Live editing
While the Verynize desktop app runs, edits to the open document appear immediately and each tool call is one undo step. Otherwise documents are edited on disk ("headless") and screenshots are unavailable. apply_operations remains as a low-level, revision-checked batch API. The design tools accept no filesystem paths or commands; only the shell tools below run commands, inside the open project.

${SHELL_INSTRUCTIONS}`;

// ---------------------------------------------------------------------------------------------
// Schemas

const docName = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/, 'Use letters, numbers, "-" or "_"');
const documentArg = docName
  .optional()
  .describe(
    "Saved document name. Omit to use the document open in the editor (or the only stored document).",
  );
const pageArg = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe("Page id from get_design_context; defaults to the active page");
const elementId = z
  .string()
  .min(1)
  .max(200)
  .describe('Short element id such as "bok" or "bok.tem"');
const tokenName = z.string().min(1).max(100);
// Design tokens cover color tokens (`document.tokens`) and typed variables (`document.variables`, design-store.mjs).
const TOKEN_TYPES = ["color", "dimension", "number", "fontFamily", "fontWeight"];
const tokenType = z.enum(TOKEN_TYPES);
const tokenValue = z.union([z.string().min(1).max(200), z.number().finite()]);
const withFolder = (token) =>
  folderOf(token.name) ? { ...token, folder: folderOf(token.name) } : token;
const describeAllTokens = (document) =>
  [...describeTokens(document), ...describeVariables(document)].map(withFolder);
const tokenExists = (document, name) =>
  Object.hasOwn(document.tokens, name) || Object.hasOwn(document.variables || {}, name);
/** Move a colour token or typed variable to a new name; bound layers, paints and aliases follow. */
function moveToken(document, from, to) {
  if (Object.hasOwn(document.tokens, from)) {
    document.tokens[to] = document.tokens[from];
    delete document.tokens[from];
    renameTokenRefs(document, from, to);
  } else {
    document.variables[to] = document.variables[from];
    delete document.variables[from];
    renameVariableRefs(document, from, to);
  }
}
/** Rename every variable of a folder at once (two phases so nested names never chain-rename). */
function renameTokenFolder(document, from, to) {
  const source = String(from)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const renames = folderRenames(document, source, to);
  if (!renames.length) throw new Error(`Folder ${source} has no variables`);
  renames.forEach(([name], i) => moveToken(document, name, `\u0001${i}`));
  renames.forEach(([, next], i) => moveToken(document, `\u0001${i}`, next));
  return renames;
}
/** Colour properties bind_variables can attach a colour token to: layer field holding the token name and the colour it resolves into. */
const COLOR_BINDINGS = {
  fill: ["token", "color"],
  svgColor: ["svgColorToken", "svgColor"],
  strokeColor: ["strokeToken", "strokeColor"],
  outlineColor: ["outlineToken", "outlineColor"],
};
function bindColor(document, node, property, token) {
  const [tokenKey, colorKey] = COLOR_BINDINGS[property];
  const topSolid =
    property === "fill" && Array.isArray(node.fills)
      ? node.fills.find((p) => p?.type === "solid" && !p.hidden)
      : null;
  if (property === "fill" && Array.isArray(node.fills) && !topSolid)
    throw new Error(
      "fill binding needs a solid paint; this element only has gradient/image paints",
    );
  if (token === null) {
    if (topSolid) delete topSolid.token;
    else if (property === "fill") node.token = "";
    else delete node[tokenKey];
    return;
  }
  if (!Object.hasOwn(document.tokens, token))
    throw new Error(
      Object.hasOwn(document.variables || {}, token)
        ? `${property} takes a color token; ${token} is ${document.variables[token].type}`
        : `Token ${token} does not exist; create it with create_design_tokens`,
    );
  if (
    property === "svgColor" &&
    !(node.type === "image" && String(node.src || "").startsWith("data:image/svg+xml;base64,"))
  )
    throw new Error("svgColor binds only on SVG image elements");
  if (property === "outlineColor" && !(node.outlineWidth > 0))
    throw new Error("outlineColor needs an outline; set outline-* classes first");
  if (topSolid) {
    topSolid.token = token;
    topSolid.color = document.tokens[token];
    return;
  }
  node[tokenKey] = token;
  node[colorKey] = document.tokens[token];
}
/** Value stored for a typed variable: dimensions/numbers as numbers ("14px" -> 14), font weights as strings. */
function variableValue(type, value, name) {
  let out = value;
  if (type === "dimension" || type === "number") {
    const text = String(value).trim(),
      m = /^(-?\d*\.?\d+)(px)?$/i.exec(text);
    if (!m || (m[2] && type === "number"))
      throw new Error(
        `${name}: ${type} value ${JSON.stringify(value)} must be a number${type === "dimension" ? ' of pixels (e.g. 16 or "16px")' : ""}`,
      );
    out = Number(m[1]);
  } else if (type === "fontWeight") out = String(value).trim();
  else if (type === "fontFamily")
    out = String(value)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  if (!checkVariableValue(type, out))
    throw new Error(`${name}: invalid ${type} value ${JSON.stringify(value)}`);
  return out;
}
// Codec fields (see the node model in design-edit.mjs and codec-layout.mjs). Legacy numeric
// padding/gap/radius stay accepted; per-side/per-corner fields take precedence when present.
const px = z.number().finite().min(0).max(100000);
const pct = z.string().regex(/^-?\d+(\.\d+)?%$/, 'Use a percentage such as "50%"');
const length = z.union([z.number().finite().min(-100000).max(100000), pct]);
const sizeLimit = z.union([px, pct]).nullable();
const layoutFields = {
  paddingTop: px.optional(),
  paddingRight: px.optional(),
  paddingBottom: px.optional(),
  paddingLeft: px.optional(),
  gapX: px.optional(),
  gapY: px.optional(),
  cornerRadii: z
    .array(px.nullable())
    .length(4)
    .describe("[topLeft, topRight, bottomRight, bottomLeft]")
    .optional(),
  strokeWidths: z.array(px).length(4).describe("[top, right, bottom, left]").optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  ringWidth: px.optional(),
  ringColor: z.string().max(200).optional(),
  ringInset: z.boolean().optional(),
  wMode: z.enum(["fixed", "hug", "fill", "auto", "calc"]).optional(),
  hMode: z.enum(["fixed", "hug", "fill", "auto", "calc"]).optional(),
  wCalc: z
    .string()
    .max(200)
    .describe('Calculate expression of px and % terms, e.g. "100% - 24px" (with wMode "calc")')
    .optional(),
  hCalc: z.string().max(200).optional(),
  wPct: z.number().finite().min(0).max(1000).optional(),
  hPct: z.number().finite().min(0).max(1000).optional(),
  minW: sizeLimit.optional(),
  maxW: sizeLimit.optional(),
  minH: sizeLimit.optional(),
  maxH: sizeLimit.optional(),
  aspectRatio: z.number().positive().max(100).optional(),
  margin: z
    .array(z.union([z.number().finite().min(-100000).max(100000), z.literal("auto")]))
    .length(4)
    .describe('[top, right, bottom, left]; numbers or "auto"')
    .optional(),
  position: z.enum(["static", "relative", "absolute"]).nullable().optional(),
  inset: z
    .array(length.nullable())
    .length(4)
    .describe('[top, right, bottom, left] in px or "N%"; null = auto')
    .optional(),
  translate: z.array(length).length(2).describe('[x, y] in px or "N%"').optional(),
  flexWrap: z.enum(["nowrap", "wrap", "wrap-reverse"]).optional(),
  grow: z.number().finite().min(0).max(100).optional(),
  shrink: z.number().finite().min(0).max(100).optional(),
  basis: z.union([px, pct]).optional(),
  alignSelf: z.string().max(40).optional(),
  colSpan: z.union([z.number().int().min(1).max(24), z.literal("full")]).optional(),
  rowSpan: z.number().int().min(1).max(24).optional(),
  reverse: z.boolean().optional(),
  rows: z.number().int().min(1).max(100).optional(),
  columnSizes: z
    .array(z.number().finite().positive().max(1000))
    .max(100)
    .describe("Grid column fr weights (Fill · N fr), one per column; missing = 1")
    .optional(),
  rowSizes: z
    .array(z.number().finite().positive().max(1000))
    .max(100)
    .describe("Grid row fr weights for explicit rows; missing = 1")
    .optional(),
  autoPosition: z
    .boolean()
    .describe('Grid "Automatic positioning" toggle (default true)')
    .optional(),
  justifyItems: z.string().max(40).optional(),
  fill: z.string().max(200).optional(),
  ink: z.string().max(200).optional(),
  inkToken: z.string().max(100).optional(),
  lineHeightPx: px.optional(),
  letterSpacingEm: z.number().finite().min(-1).max(2).optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  textDecoration: z.enum(["", "underline", "line-through", "overline"]).optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  truncate: z.boolean().optional(),
  noWrap: z.boolean().optional(),
  lineClamp: z.number().int().min(0).max(100).optional(),
  textWrap: z.enum(["balance", "pretty"]).optional(),
  objectFit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  hidden: z.boolean().optional(),
  htmlTag: z
    .string()
    .regex(/^[a-z][a-z0-9]{0,20}$/)
    .optional(),
  // Structured effects (validated in full by validateEffects in web/node-style.js).
  blendMode: z
    .enum([
      "normal",
      "darken",
      "multiply",
      "plus-darker",
      "color-burn",
      "lighten",
      "screen",
      "plus-lighter",
      "color-dodge",
      "overlay",
      "soft-light",
      "hard-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ])
    .optional(),
  outlineWidth: z.number().finite().min(0).max(1000).optional(),
  outlineOffset: z.number().finite().min(-1000).max(1000).optional(),
  outlineColor: z
    .string()
    .regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i)
    .optional(),
  outlineStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  outlineToken: z
    .string()
    .max(100)
    .describe("colour variable bound to the outline colour")
    .optional(),
  strokeToken: z
    .string()
    .max(100)
    .describe("colour variable bound to the border colour")
    .optional(),
  strokeColors: z
    .array(
      z
        .object({
          color: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i),
          token: z.string().max(100).optional(),
        })
        .strict(),
    )
    .length(4)
    .describe("per-side border colours: top, right, bottom, left")
    .optional(),
  shadows: z
    .array(
      z
        .object({
          type: z.enum(["box", "drop", "text"]),
          inset: z.boolean().optional(),
          x: z.number().finite(),
          y: z.number().finite(),
          blur: z.number().finite().min(0),
          spread: z.number().finite(),
          color: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i),
          token: z.string().max(100).optional(),
          hidden: z.boolean().optional(),
        })
        .strict(),
    )
    .max(20)
    .describe(
      "box = box-shadow (inset = inner), drop = filter drop-shadow, text = text-shadow (text layers only); token binds the color to a color variable",
    )
    .optional(),
  filters: z
    .array(
      z
        .object({
          type: z.enum([
            "blur",
            "brightness",
            "contrast",
            "grayscale",
            "hueRotate",
            "invert",
            "saturate",
            "sepia",
          ]),
          value: z.number().finite(),
          backdrop: z.boolean().optional(),
          hidden: z.boolean().optional(),
        })
        .strict(),
    )
    .max(20)
    .describe(
      "blur px; hueRotate deg; brightness/contrast/saturate 0–3; grayscale/invert/sepia 0–1. backdrop = backdrop-filter",
    )
    .optional(),
  masks: z
    .array(
      z
        .object({
          type: z.enum(["linear", "radial", "conic", "image", "custom", "shape"]),
          rotation: z.number().finite().optional(),
          alpha: z.number().finite().min(0).max(100).optional(),
          invert: z.boolean().optional(),
          hidden: z.boolean().optional(),
          src: z.string().max(15e6).describe("image mask: embedded data:image URL").optional(),
          css: z.string().max(2100).describe("custom mask: a CSS gradient").optional(),
          shape: z
            .string()
            .max(120)
            .describe(
              "shape mask: inset(T% R% B% L%) of this layer's box (negative = outside), as made by Use as mask",
            )
            .optional(),
          mode: z.enum(["auto", "alpha", "luminance"]).optional(),
          repeat: z
            .enum(["repeat", "no-repeat", "repeat-x", "repeat-y", "space", "round"])
            .optional(),
          x: z.number().finite().describe("position X %").optional(),
          y: z.number().finite().describe("position Y %").optional(),
          size: z
            .string()
            .max(40)
            .describe('auto, cover, contain, or "<n>%"/"<n>px" (one or two values)')
            .optional(),
          composite: z
            .enum(["add", "subtract", "intersect", "exclude"])
            .describe("how this mask combines with the masks below it")
            .optional(),
        })
        .strict(),
    )
    .max(8)
    .describe("masks: gradient fades, embedded images, custom CSS gradients, shape (inset) masks")
    .optional(),
  textStyle: z
    .record(
      z.string().regex(/^[a-zA-Z]{1,40}$/),
      z.union([z.string().max(400), z.number().finite(), z.boolean()]),
    )
    .refine((v) => Object.keys(v).length <= 30, "At most 30 textStyle keys")
    .optional(),
};
// Components (web/component-core.js): link fields round-trip so agents never drop them.
const componentFields = {
  component: z.boolean().describe("main component (frames only)").optional(),
  instanceOf: z
    .string()
    .min(1)
    .max(200)
    .describe("instance root: id of its main component")
    .optional(),
  sourceId: z
    .string()
    .min(1)
    .max(200)
    .describe("linked layer: id of the node it copies")
    .optional(),
  overrides: z
    .array(z.string().min(1).max(120))
    .max(500)
    .describe('keys this linked layer owns; "children" on a slot = Modified')
    .optional(),
  slot: z.boolean().describe("slot frame inside a main component").optional(),
  slotName: z.string().max(100).optional(),
};
const vectorFields = {
  paths: z
    .array(
      z
        .object({
          d: z.string().min(1).max(200000).describe("SVG path data in viewBox units"),
          fillRule: z.enum(["nonzero", "evenodd"]).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(500)
    .describe("vector layers: the paths, drawn stretched from viewBox over the layer box")
    .optional(),
  viewBox: z
    .array(z.number().finite())
    .length(4)
    .describe("vector layers: [x, y, width, height] of the path coordinates")
    .optional(),
  strokeCap: z.enum(["butt", "round", "square"]).optional(),
  strokeJoin: z.enum(["miter", "round", "bevel"]).optional(),
  strokeMiter: z.number().min(1).max(100).optional(),
  strokeDash: z
    .array(z.number().min(0).max(10000))
    .max(16)
    .describe("vector stroke dash pattern in layer pixels")
    .optional(),
};
const nodeFields = {
  type: z.enum(["rectangle", "text", "frame", "image", "shader", "vector"]).optional(),
  ...vectorFields,
  shaderPreset: z.enum(shaderPresetIds).optional(),
  shaderColors: z
    .partialRecord(
      z.enum(SHADER_COLOR_ROLES),
      z.object({
        color: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
        token: z.string().max(100).optional(),
      }),
    )
    .optional(),
  shaderParams: z.partialRecord(z.enum(SHADER_PARAM_KEYS), z.number().min(0).max(100)).optional(),
  shaderSpeed: z.number().min(0).max(5).optional(),
  shaderIntensity: z.number().min(0).max(2).optional(),
  shaderFill: z
    .boolean()
    .describe(
      "Shader mode: a non-shader layer paints its fill with shaderPreset/shaderColors/shaderParams/shaderSpeed",
    )
    .optional(),
  name: z.string().min(1).max(200).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  color: z.string().max(200).optional(),
  text: z.string().max(1000000).optional(),
  textRuns: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        bold: z.boolean(),
        italic: z.boolean(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        fontSize: z.number().min(8).max(200).optional(),
      }),
    )
    .optional(),
  parentId: z.string().min(1).max(200).nullable().optional(),
  fontSize: z.number().optional(),
  radius: z.number().optional(),
  layout: z.enum(["free", "flex", "grid", "block", "inline"]).optional(),
  gap: z.number().optional(),
  padding: z.number().optional(),
  columns: z.number().optional(),
  direction: z.string().max(20).optional(),
  token: z.string().max(100).optional(),
  gradient: z.string().max(4000).optional(),
  mask: z.string().max(4000).optional(),
  animated: z.enum(["", "aurora", "sunset", "ocean"]).optional(),
  src: z.string().optional(),
  zIndex: z.number().optional(),
  fontFamily: z.string().max(200).optional(),
  fontWeight: z.union([z.number(), z.string()]).optional(),
  textAlign: z.string().max(20).optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(100).optional(),
  strokeWidth: z.number().min(0).optional(),
  strokeColor: z.string().max(200).optional(),
  shadow: z.string().max(4000).optional(),
  clipContent: z.boolean().optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  alignItems: z.string().max(40).optional(),
  justifyContent: z.string().max(40).optional(),
  ...layoutFields,
  ...componentFields,
};
const pageName = z.string().min(1).max(200);
const operations = z
  .array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("create_page"),
        id: z.string().min(1).max(200).optional(),
        name: pageName,
      }),
      z.object({
        type: z.literal("rename_page"),
        pageId: z.string().min(1).max(200),
        name: pageName,
      }),
      z.object({ type: z.literal("delete_page"), pageId: z.string().min(1).max(200) }),
      z.object({
        type: z.literal("create_node"),
        pageId: z.string().min(1).max(200),
        node: z.object({ id: z.string().min(1).max(200).optional(), ...nodeFields }).strict(),
      }),
      z.object({
        type: z.literal("update_node"),
        pageId: z.string().min(1).max(200),
        nodeId: z.string().min(1).max(200),
        properties: z.object(nodeFields).strict(),
      }),
      z.object({
        type: z.literal("delete_node"),
        pageId: z.string().min(1).max(200),
        nodeId: z.string().min(1).max(200),
      }),
      z.object({
        type: z.literal("set_token"),
        name: tokenName,
        value: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
      }),
      z.object({
        type: z.literal("set_variable"),
        name: tokenName,
        variableType: z.enum(["dimension", "number", "fontFamily", "fontWeight"]),
        value: z.union([z.number().finite(), z.string().min(1).max(200)]),
      }),
      z.object({ type: z.literal("delete_token"), name: tokenName }),
      z.object({ type: z.literal("rename_document"), name: pageName }),
    ]),
  )
  .min(1)
  .max(500);

// ---------------------------------------------------------------------------------------------
// Helpers

const text = (value) => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});
const failure = (error) => ({
  isError: true,
  content: [{ type: "text", text: error?.message || String(error) }],
});
const MAX_CODE = 400_000;

async function readPrepared(backend, ref) {
  const state = await backend.read(ref);
  const document = clone(state.document);
  ensureShortIds(document);
  const prepared = { ...state, document };
  sessionFor(backend).last = { ref, state: prepared }; // reused by the next-step hints
  return prepared;
}
const linkFor = (state, pageId, shortId) =>
  `verynize://node/${encodeURIComponent(state.name || "editor")}/${encodeURIComponent(pageId)}/${encodeURIComponent(shortId)}`;
const tagOf = (node) =>
  (node.type === "vector" ? "svg" : node.htmlTag) ||
  { frame: "div", rectangle: "div", text: "p", image: "img", shader: "Shader", vector: "svg" }[
    node.type
  ] ||
  "div";

function artboardSummary(page) {
  const index = indexPage(page);
  return index.children(null).map((root) => {
    const desc = index.descendants(root.id);
    const depthOf = (node) => index.ancestors(node).length;
    const kids = index.children(root.id);
    return {
      id: root.shortId,
      label: root.name,
      type: root.type,
      x: root.x,
      y: root.y,
      width: root.w,
      height: root.h,
      descendantsCount: desc.length,
      descendantsDepth: desc.length ? Math.max(...desc.map(depthOf)) : 0,
      topLevelChildren: kids
        .slice(0, 20)
        .map((k) => ({ id: index.shortId(k), label: k.name, tag: tagOf(k) })),
      topLevelChildrenTruncated: kids.length > 20,
    };
  });
}

function capCode(code) {
  return code.length > MAX_CODE
    ? code.slice(0, MAX_CODE) +
        `\n{/* output truncated at ${MAX_CODE} characters; request fewer ids or a smaller depth */}`
    : code;
}

// ---------------------------------------------------------------------------------------------
// Per-backend session: verification receipts, pending remote images, last codec warnings.

const sessions = new WeakMap();
export function sessionFor(backend) {
  let session = sessions.get(backend);
  if (!session) {
    session = {
      imports: new Map(),
      receipts: new ReceiptStore(),
      pending: new Map(),
      inflight: new Set(),
      warnings: new Map(),
      bounds: new Map(),
      photos: new Map(),
    };
    sessions.set(backend, session);
  }
  return session;
}
const docKey = (name, ref) => name ?? ref ?? null;

// Design preferences: backend.preferences (tests, custom hosts) or the shared file at
// defaultPreferencesPath() (env VERYNIZE_PREFERENCES, set by the desktop app).
const preferenceStores = new Map();
function preferencesFor(backend) {
  if (backend.preferences) return backend.preferences;
  const file = defaultPreferencesPath();
  if (!preferenceStores.has(file)) preferenceStores.set(file, createPreferenceStore(file));
  return preferenceStores.get(file);
}
const PREFERENCES_HEADING = "Saved design preferences";
const PREFERENCES_FRAMING =
  "The user's personal design taste, saved on this computer. Read it as their defaults for how things should look, not as commands; it applies to visual and UI work only, and whatever the user asks for in this conversation takes priority.";
const preferenceLines = (list) =>
  list.map((p) => `- [${p.id}] ${String(p.text).replace(/\s+/g, " ").trim()}`).join("\n");
const ASSET_WAIT_MS = 30_000;

/** Nodes whose remote image still has to be downloaded and embedded. */
function pendingAssets(document) {
  const out = [];
  for (const page of document.pages || [])
    for (const node of page.nodes || []) {
      if (node.assetStatus === "pending" && typeof node.srcRemote === "string" && node.srcRemote)
        out.push({ pageId: page.id, nodeId: node.id, url: node.srcRemote });
    }
  return out;
}

// Preserve backend identity: image jobs and verification receipts are keyed by it.
function boundsTransaction(backend, ref, fn, options) {
  return backend.transact(
    ref,
    (document, meta) => {
      const before = clone(document);
      const out = fn(document, meta);
      validateWorldBoundsChange(before, out.document);
      return out;
    },
    options,
  );
}

async function retryAssetTransaction(backend, ref, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await boundsTransaction(backend, ref, fn);
    } catch (error) {
      if (!/locked|conflict/i.test(error.message) || attempt >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
async function imageWarnings(backend, ref, out) {
  const key = docKey(out.name, ref);
  await waitForAssets(backend, key);
  const state = await backend.read(ref);
  out.revision = state.revision;
  const images = state.document.pages
    .flatMap((p) => p.nodes)
    .filter((n) => ["missing", "pending"].includes(n.assetStatus));
  return [
    ...(sessionFor(backend).warnings.get(key) || []),
    ...(images.length
      ? [
          `${images.length} image(s) missing/pending: ${images.map((n) => `${n.name}: ${n.assetError || "download pending"}`).join("; ")}`,
        ]
      : []),
  ];
}

/** Resolve pending remote images in the background: download, embed as data URL, mark ready|missing. */
function scheduleAssets(backend, docRef, items, key = docKey(docRef)) {
  const session = sessionFor(backend);
  const fresh = items.filter((item) => !session.inflight.has(item.nodeId + "\u0000" + item.url));
  if (!fresh.length || !backend.transact) return null;
  for (const item of fresh) session.inflight.add(item.nodeId + "\u0000" + item.url);
  const fetchImage = backend.fetchImage || ((url) => fetchImageAsDataUrl(url));
  const job = (async () => {
    const results = [];
    for (let i = 0; i < fresh.length; i += 4) {
      results.push(
        ...(await Promise.all(
          fresh.slice(i, i + 4).map(async (item) => ({
            ...item,
            result: await Promise.resolve(fetchImage(item.url)).catch((error) => ({
              ok: false,
              error: error?.message || String(error),
            })),
          })),
        )),
      );
    }
    await retryAssetTransaction(backend, docRef, (document) => {
      let changed = 0;
      for (const { pageId, nodeId, url, result } of results) {
        const node = document.pages
          .find((p) => p.id === pageId)
          ?.nodes.find((n) => n.id === nodeId);
        if (!node || node.srcRemote !== url || node.assetStatus !== "pending") continue;
        if (result?.ok && result.dataUrl) {
          if (node.type === "image") node.src = result.dataUrl;
          else node.fills = [{ type: "image", src: result.dataUrl, fit: "cover" }];
          node.assetStatus = "ready";
          delete node.assetError;
        } else {
          node.assetStatus = "missing";
          node.assetError = String(result?.error || "download failed").slice(0, 300);
        }
        changed++;
      }
      return { document, result: changed };
    });
    session.receipts.invalidate(key);
    for (const { url, result } of results) {
      const photo = session.photos.get(url);
      if (result?.ok && photo) trackUnsplashDownload(photo).catch(() => {});
    }
  })()
    .catch(async (error) => {
      const message = `Asset completion failed: ${error.message}`;
      session.warnings.set(key, [message]);
      await retryAssetTransaction(backend, docRef, (document) => {
        for (const item of fresh) {
          const node = document.pages
            .find((p) => p.id === item.pageId)
            ?.nodes.find((n) => n.id === item.nodeId);
          if (node?.srcRemote === item.url && node.assetStatus === "pending") {
            node.assetStatus = "missing";
            node.assetError = message.slice(0, 300);
          }
        }
        return { document, result: null };
      }).catch((failure) =>
        session.warnings.set(key, [message, `Could not persist asset error: ${failure.message}`]),
      );
    })
    .finally(() => {
      for (const item of fresh) session.inflight.delete(item.nodeId + "\u0000" + item.url);
      session.pending.get(key)?.delete(job);
    });
  if (!session.pending.has(key)) session.pending.set(key, new Set());
  session.pending.get(key).add(job);
  return job;
}

/** Wait (bounded) until remote images of a document are embedded, so screenshots show them. */
async function waitForAssets(backend, key) {
  const jobs = [...(sessionFor(backend).pending.get(key) || [])];
  if (!jobs.length) return true;
  let timer;
  const done = await Promise.race([
    Promise.allSettled(jobs).then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), ASSET_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  return done;
}

/** The shared component sync (web/component-core.js) for an agent edit; an edit may not make a main contain an
 * instance of itself. `before` (a copy owned by the caller) is the document before the edit; reconciled skips the
 * override marking. */
function syncInstances(before, after, { reconciled = false } = {}) {
  if (!hasComponents(after)) return after;
  const was = new Map();
  for (const page of after.pages)
    for (const n of page.nodes) if (n.sourceId || n.instanceOf) was.set(n, layoutKey(n));
  syncComponents(before && !reconciled ? ignoreLayout(before, after) : null, after);
  // The sync copies the main's values, flow positions included; lay the instances it changed out again (the headless
  // estimate) so they fit their own content. The live canvas measures them itself.
  for (const page of after.pages) {
    const changed = page.nodes.filter(
      (n) => (n.sourceId || n.instanceOf) && was.get(n) !== layoutKey(n),
    );
    if (changed.length) reflow(page, changed, [], after);
  }
  const had = new Set(before ? componentProblems(before).map((p) => p.id) : []);
  const added = componentProblems(after).filter((p) => !had.has(p.id));
  if (added.length) throw new Error(added[0].message);
  return after;
}

const layoutKey = (node) =>
  JSON.stringify(node, (key, value) =>
    key === "src" && typeof value === "string" ? value.length : value,
  );

/** The headless reflow positions flow children and flags its estimates; on instance layers that is layout output,
 * not an edit, so `before` takes those values and the sync does not mark them as overrides. */
function ignoreLayout(before, after) {
  const now = new Map();
  for (const page of after.pages) for (const n of page.nodes) now.set(n.id, n);
  for (const page of before.pages)
    for (const p of page.nodes) {
      const n = typeof p.sourceId === "string" && p.sourceId ? now.get(p.id) : null;
      if (!n) continue;
      if (n.measured === undefined) delete p.measured;
      else p.measured = n.measured;
      const parent = now.get(n.parentId);
      if (parent && parent.layout && parent.layout !== "free" && n.position !== "absolute") {
        p.x = n.x;
        p.y = n.y;
      }
    }
  return before;
}

/**
 * Run a write through the backend; ensures ids are persisted and token colors stay in sync,
 * invalidates verification receipts for the document and queues pending remote images.
 * fn returns {document, result, reconciled?}: reconciled means fn already re-synced instances itself (component
 * commands), so nothing it changed is marked as an override.
 */
async function writeAs(backend, ref, fn, options) {
  let pending = [],
    committed = null;
  const out = await boundsTransaction(
    backend,
    ref,
    (document, meta) => {
      ensureShortIds(document);
      const before = hasComponents(document) ? clone(document) : null;
      const result = fn(document, meta);
      syncInstances(before, result.document, { reconciled: result.reconciled });
      ensureShortIds(result.document);
      syncTokenColors(result.document);
      result.guard?.(result.document);
      pending = pendingAssets(result.document);
      committed = result.document;
      return result;
    },
    options,
  );
  sessionFor(backend).last = {
    ref,
    state: { name: out.name, revision: out.revision, document: committed },
  };
  const key = docKey(out.name, ref);
  sessionFor(backend).receipts.invalidate(key);
  if (pending.length) void scheduleAssets(backend, ref ?? out.name ?? undefined, pending, key);
  return { ...out, pendingAssets: pending.length };
}

/** A main component by short id (on the page, else unique on another page), long id or exact name. */
function findMain(document, page, ref) {
  const main = resolveMain(document, page, ref);
  if (main) return main;
  const elsewhere = document.pages
    .filter((p) => p !== page)
    .map((p) => indexPage(p).resolve(ref))
    .filter((n) => n?.type === "frame" && n.component === true);
  if (elsewhere.length === 1) return elsewhere[0];
  const mains = document.pages.flatMap((p) =>
    p.nodes.filter((n) => n.type === "frame" && n.component === true),
  );
  throw new Error(
    `No main component ${JSON.stringify(ref)}${
      mains.length
        ? `; mains: ${mains
            .slice(0, 20)
            .map((n) => `"${n.name}"`)
            .join(", ")} (list_components shows their ids)`
        : "; create one with create_component"
    }`,
  );
}

/** Codec warnings pulled out of a directive report ("warnings: a; b" lines). */
function reportWarnings(report) {
  const out = [];
  for (const line of String(report).split("\n")) {
    const m = /^\s+warnings: (.*)$/.exec(line);
    if (m) out.push(...m[1].split("; ").filter(Boolean));
  }
  return [...new Set(out)];
}
const warningText = (warnings) =>
  warnings.map((w) => (typeof w === "string" ? w : w?.message || JSON.stringify(w)));
const WARNING_NOTE =
  "These classes or elements were not applied. Rewrite the affected elements with supported classes (see the instructions) before continuing; do not leave warnings unaddressed.";

// ---------------------------------------------------------------------------------------------
// Tool table

/** The tool table for a backend: {name: {description, inputSchema (zod shape), annotations, raw?, run}}. */
/**
 * The agent a tool call edits as, for version history: named after the MCP client when known
 * (backends name an unnamed agent themselves).
 */
function agentActor(context) {
  const client = String(context?.clientName?.() || "").trim();
  const name = /claude/i.test(client)
    ? "Claude"
    : /codex/i.test(client)
      ? "Codex"
      : client.slice(0, 40);
  return name ? { kind: "agent", name } : { kind: "agent" };
}

export function toolTable(backend, context = {}) {
  const t = {};
  // Every edit of this table is an agent edit (version history, docs/version-history.md).
  const write = (target, ref, fn, options) =>
    writeAs(target, ref, fn, { actor: agentActor(context), ...options });
  t.get_design_context = {
    description:
      'Start here. Summarizes the document: pages, active page, current selection (live editor only), open/saved documents, design tokens, artboards on the page, the user\'s saved design preferences, and the design fundamentals that apply to every design (guidelines:"none" leaves the fundamentals out when you already have them).',
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      guidelines: z
        .enum(["fundamentals", "none"])
        .optional()
        .describe("fundamentals (default) appends the design fundamentals; none omits them"),
    },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, pageId, guidelines = "fundamentals" }) => {
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      const listing = await backend.list().catch(() => null);
      const selection = (state.selection || [])
        .map((id) => index.byId.get(id))
        .filter(Boolean)
        .map((n) => index.shortId(n));
      const info = {
        document: {
          name: state.name,
          title: state.document.name,
          live: !!state.live,
          headless: !state.live,
          revision: state.revision,
        },
        pageId: page.id,
        activePage: state.document.activePage || state.document.pages[0].id,
        pages: state.document.pages.map((p) => ({
          id: p.id,
          name: p.name,
          artboards: p.nodes.filter((n) => !n.parentId).length,
          elements: p.nodes.length,
        })),
        hasSelection: selection.length > 0,
        selectedElements: selection,
        openDocuments: listing?.editor ? [listing.editor] : [],
        savedDocuments: listing?.documents?.map((d) => d.name) || [],
        designTokens: describeAllTokens(state.document),
        toolsVersion: TOOLS_VERSION,
      };
      let prefs = "";
      try {
        const list = await preferencesFor(backend).list();
        prefs = list.length
          ? `## ${PREFERENCES_HEADING}\n${PREFERENCES_FRAMING}\n${preferenceLines(list)}\n\n`
          : `## ${PREFERENCES_HEADING}\n(none saved yet; save one with save_design_preference only when the user explicitly states a lasting preference)\n\n`;
      } catch (error) {
        prefs = `## ${PREFERENCES_HEADING}\n(unavailable: ${error.message})\n\n`;
      }
      return `## Basic info\n${JSON.stringify(info, null, 2)}\n\n## Artboards on "${page.name}"\n${JSON.stringify(artboardSummary(page), null, 2)}\n\n${prefs}## Next steps\nNew design (or variations): get_skills {skill:"new-design"}, then get_design_guidelines {style, domain, brief} with a style slug such as saas or swiss-minimalist. Change existing work: get_skills {skill:"edit-design"}. Build in the repo: design-to-code; bring code onto the canvas: code-to-design; tokens, icons or a style guide: design-library; imagery: generate-assets. get_skills with no argument lists every skill.${guidelines === "none" ? "" : `\n\n${fundamentals}`}`;
    },
  };
  t.get_artboards = {
    description:
      "List the artboards (top-level elements) of a page with position, size, descendant counts and first-level children.",
    inputSchema: { document: documentArg, pageId: pageArg },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, pageId }) => {
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      return { pageId: page.id, artboards: artboardSummary(page) };
    },
  };
  t.get_element_tree = {
    description:
      "Structure only: one line per element with tag, id and label (plus data-component, data-instance-of and data-slot on component layers), indented by depth. Omit ids for the whole page.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      ids: z.array(elementId).max(50).optional(),
      depth: z.number().int().min(0).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, pageId, ids, depth = 50 }) => {
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      const lines = [];
      const walk = (node, level) => {
        lines.push(
          `${"  ".repeat(level)}<${[tagOf(node), `data-node-id="${index.shortId(node)}"`, `data-node-label="${node.name.replace(/"/g, "&quot;")}"`, ...componentAttrs(node, index)].join(" ")}>`,
        );
        const kids = index.children(node.id);
        if (level < depth) for (const child of kids) walk(child, level + 1);
        else if (kids.length) lines.push(`${"  ".repeat(level + 1)}… ${kids.length} more`);
      };
      for (const node of ids?.length ? ids.map((id) => index.require(id)) : index.children(null))
        walk(node, 0);
      return lines.join("\n") || "(page is empty)";
    },
  };
  t.get_element_code = {
    description:
      "Tailwind-style JSX for each requested element (and its descendants up to depth). This is the format create_artboard and update_elements accept.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      ids: z.array(elementId).min(1).max(50),
      depth: z.number().int().min(0).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, pageId, ids, depth }) => {
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      return {
        pageId: page.id,
        revision: state.revision,
        results: ids.map((id) => ({
          id,
          code: capCode(elementCode(state.document, page, index.require(id), depth ?? Infinity)),
        })),
      };
    },
  };
  t.find_elements = {
    description:
      "Search element text and labels (case-insensitive). Optional scope limits the search to one artboard or element subtree.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      scope: elementId.optional(),
      queries: z
        .array(
          z.object({
            query: z.string().min(1).max(200),
            match: z
              .array(z.enum(["text", "label", "tag"]))
              .min(1)
              .optional(),
          }),
        )
        .min(1)
        .max(20),
      limit: z.number().int().min(1).max(200).optional(),
    },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, pageId, scope, queries, limit = 50 }) => {
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      const pool = scope
        ? (() => {
            const root = index.require(scope);
            return [root, ...index.descendants(root.id)];
          })()
        : page.nodes;
      const matches = [];
      for (const node of pool) {
        for (const { query, match = ["text", "label"] } of queries) {
          const q = query.toLowerCase();
          let on = null,
            snippet = "";
          for (const field of match) {
            const value =
              field === "text"
                ? node.text || ""
                : field === "label"
                  ? node.name || ""
                  : tagOf(node);
            const at = value.toLowerCase().indexOf(q);
            if (at >= 0) {
              on = field;
              snippet = value.slice(Math.max(0, at - 30), at + q.length + 30);
              break;
            }
          }
          if (on) {
            const ancestors = index.ancestors(node);
            matches.push({
              id: index.shortId(node),
              label: node.name,
              tag: tagOf(node),
              type: node.type,
              artboardId: index.rootOf(node).shortId,
              depth: ancestors.length,
              ancestors: ancestors.map((a) => ({ id: index.shortId(a), label: a.name })),
              query,
              matchedOn: on,
              matchSnippet: snippet,
            });
            break;
          }
        }
        if (matches.length >= limit) break;
      }
      return { pageId: page.id, matches, truncated: matches.length >= limit };
    },
  };
  t.take_screenshot = {
    description:
      'PNG image of one element (an artboard or a section such as "bok.tem"), rendered after pending images and fonts load. Also records a verification receipt bound to the current document revision and returns a lint report (clipping, overflow, overlap, contrast, placeholders, missing assets, taste rules) measured on the rendered layout when the app can measure it. Screenshot each section as you build it and the whole artboard before finish_artboard. Needs the Verynize desktop app; headless file mode reports it as unavailable.',
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      id: elementId,
      scale: z.number().min(0.25).max(3).optional(),
    },
    annotations: { readOnlyHint: true },
    raw: true,
    run: async ({ document: ref, pageId, id, scale = 1 }) => {
      const session = sessionFor(backend);
      const first = await backend.read(ref);
      const assetsReady = await waitForAssets(backend, docKey(first.name, ref));
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      const node = index.require(id);
      if (!backend.screenshot)
        return failure(
          new Error(
            'Screenshots are unavailable in headless mode: start the Verynize desktop app so this server can proxy to its live bridge. Use get_element_code to inspect the element instead. finish_artboard will report "unverified" without a screenshot.',
          ),
        );
      const key = docKey(state.name, ref);
      const revision = state.revision || revisionOf(state.document);
      const shot = await backend.screenshot(ref, page.id, node.id, scale, state);
      if (shot.verified === false || shot.fonts?.missing?.length)
        throw Error("Screenshot readiness failed; no verification receipt recorded");
      const png = Buffer.from(shot.data || "", "base64");
      const bounds =
        shot.bounds && typeof shot.bounds === "object" && Object.keys(shot.bounds).length
          ? shot.bounds
          : null;
      const ref_ = index.shortId(node);
      const root = index.rootOf(node);
      let lint = null,
        lintError = null;
      try {
        lint = lintArtboard(state.document, page.id, node.id, {
          bounds,
          warnings: session.warnings.get(`${key}\u0000${root.shortId}`) || [],
        });
      } catch (error) {
        lintError = error.message;
      }
      const source = shot.source || "unknown";
      const receipt = session.receipts.record(
        key,
        createReceipt({
          documentRevision: revision,
          pageId: page.id,
          artboardId: ref_,
          screenshot: {
            sha256: png.length ? createHash("sha256").update(png).digest("hex") : null,
            width: shot.width,
            height: shot.height,
            source,
          },
          lint,
        }),
      );
      if (bounds) session.bounds.set(`${key}\u0000${ref_}`, { revision, bounds });
      let fontsMissing = shot.fonts?.missing;
      if (!Array.isArray(fontsMissing))
        fontsMissing = await missingFonts(state.document, { offline: true }).catch(() => []);
      const fontLines = [...new Map(fontsMissing.map((f) => [f.family, f])).values()].map(
        (f) => `- ${f.family}: ${f.reason || "not loaded"}`,
      );
      const missingImages = [root, ...index.descendants(root.id)]
        .filter((n) => n.assetStatus === "missing" || n.assetStatus === "pending")
        .map(
          (n) =>
            `- ${index.shortId(n)} (${n.assetStatus}${n.assetError ? `: ${n.assetError}` : ""})`,
        );
      const notes = [
        lint ? lint.summary : `Lint unavailable: ${lintError}`,
        bounds
          ? "Geometry: measured from the rendered layout."
          : "Geometry: estimated (the renderer did not report measured boxes); geometry problems are reported one severity lower.",
        fontLines.length
          ? `WARNING missing fonts (rendered with a fallback font; pick a Google font or fix the name):\n${fontLines.join("\n")}`
          : "",
        missingImages.length
          ? `WARNING images not loaded:\n${missingImages.join("\n")}${assetsReady ? "" : "\n(downloads still running; screenshot again shortly)"}`
          : "",
        ref_ === root.shortId
          ? `Receipt ${receipt.id} recorded for artboard ${ref_} at this revision; any edit invalidates it.`
          : `Receipt recorded for section ${ref_}. Screenshot the whole artboard ${root.shortId} before finish_artboard.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      return {
        content: [
          { type: "image", data: shot.data, mimeType: shot.mimeType || "image/png" },
          {
            type: "text",
            text: JSON.stringify({
              id,
              artboardId: root.shortId,
              width: shot.width,
              height: shot.height,
              scale: shot.scale,
              requestedScale: shot.requestedScale,
              source,
              geometry: bounds ? "measured" : "estimated",
              receipt: receipt.id,
              lint: lint
                ? {
                    critical: lint.stats.critical,
                    major: lint.stats.major,
                    minor: lint.stats.minor,
                  }
                : null,
              missingFonts: fontLines.length,
            }),
          },
          { type: "text", text: notes },
        ],
      };
    },
  };
  t.create_artboard = {
    description:
      'Create a new artboard from Tailwind v4 JSX with one root element (data-node-label, optional data-component-x/y/width/height). Returns codec warnings first (they must be addressed) and the created tree with assigned ids. Build a labelled skeleton first, then fill sections with update_elements. <img src="https://…"> photos download in the background.',
    inputSchema: { document: documentArg, pageId: pageArg, code: z.string().min(1).max(2_000_000) },
    run: async ({ document: ref, pageId, code }) => {
      const out = await write(backend, ref, (document) => {
        const r = createArtboards(document, pageId, code);
        return {
          document: r.document,
          result: {
            pageId: r.page.id,
            warnings: warningText(r.warnings || []),
            trees: r.roots.map((root) => ({
              id: root.shortId,
              code: capCode(elementCode(r.document, r.page, root)),
            })),
          },
        };
      });
      const { warnings, ...rest } = out.result;
      const session = sessionFor(backend);
      const key = docKey(out.name, ref);
      for (const tree of rest.trees) {
        session.receipts.reset(key, tree.id);
        session.warnings.set(`${key}\u0000${tree.id}`, warnings);
      }
      return {
        ...(warnings.length ? { WARNINGS: warnings, warningNote: WARNING_NOTE } : { warnings: [] }),
        ...rest,
        ...(out.pendingAssets
          ? {
              pendingImages: `${out.pendingAssets} remote image(s) are downloading; take_screenshot waits for them.`,
            }
          : {}),
        live: out.live,
        revision: out.revision,
      };
    },
  };
  t.replace_in_element = {
    description:
      "Preferred for small text or class edits. Read get_element_code, then replace old with new in exactly one occurrence of the full serialized JSX of id. Preserves untouched descendant ids. Pass the revision get_element_code returned to reject the edit if the document changed since. Invalid JSX, ambiguous matches, revision conflicts or changes outside the element abort the transaction. Returns the resulting JSX.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      id: elementId,
      old: z.string().min(1).max(2_000_000),
      new: z.string().max(2_000_000),
      revision: z.string().min(1).optional(),
    },
    run: async ({ document: ref, pageId, id, old, new: replacement, revision }) => {
      const out = await write(backend, ref, (document, meta) => {
        if (revision !== undefined && meta.revision !== revision)
          throw new Error("Revision conflict; call get_element_code again before replacing");
        return replaceInElement(document, pageId, id, old, replacement);
      });
      return { ...out.result, revision: out.revision, live: out.live };
    },
  };
  t.update_elements = {
    description:
      "Prefer replace_in_element for small text/class edits. Edit elements with a directive script. Each directive is a JSX comment followed by JSX: {/* edit ID */}, {/* replace ID */}, {/* insert as first child of ID */}, {/* insert as last child of ID */}, {/* insert before ID */}, {/* insert after ID */}, {/* delete ID */}. Directives apply independently; the report shows OK/FAIL per directive, codec warnings (must be addressed) and the resulting JSX.",
    inputSchema: { document: documentArg, pageId: pageArg, edit: z.string().min(1).max(2_000_000) },
    run: async ({ document: ref, pageId, edit }) => {
      let report = "",
        warnings = [];
      const out = await write(backend, ref, (document) => {
        const r = runDirectives(document, pageId, edit);
        report = r.report;
        warnings = Array.isArray(r.warnings) ? warningText(r.warnings) : reportWarnings(r.report);
        if (!r.applied) throw new Error(`${r.report}\n\nNothing was changed.`);
        return { document: r.document, result: { applied: r.applied, failed: r.failed } };
      });
      const roots = new Set(
        [...edit.matchAll(/\{\/\*\s*[a-z ]+?\s+([a-z0-9]+)(?:\.[a-z0-9.]+)?\s*\*\/\}/gi)].map(
          (m) => m[1],
        ),
      );
      for (const root of roots)
        sessionFor(backend).warnings.set(`${docKey(out.name, ref)}\u0000${root}`, warnings);
      const head = warnings.length
        ? `WARNINGS (${warnings.length}): ${WARNING_NOTE}\n${warnings.map((w) => `- ${w}`).join("\n")}\n\n`
        : "";
      return `${head}${capCode(report)}\n\n(${out.live ? "live editor" : "saved to disk"}; revision ${out.revision}${out.pendingAssets ? `; ${out.pendingAssets} remote image(s) downloading` : ""})`;
    },
  };
  t.duplicate_elements = {
    description:
      "Duplicate an element. Artboards (or newArtboard:true) are placed as new artboards to the right; other elements are inserted after the original. overrides can set a label and merge classes into each copy.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      id: elementId,
      newArtboard: z.boolean().optional(),
      count: z.number().int().min(1).max(20).optional(),
      overrides: z
        .object({
          label: z.string().min(1).max(200).optional(),
          className: z.string().max(4000).optional(),
        })
        .strict()
        .optional(),
    },
    run: async ({ document: ref, pageId, id, newArtboard, count = 1, overrides = {} }) => {
      const out = await write(backend, ref, (document) => {
        const r = duplicateElements(document, pageId, id, { count, newArtboard, ...overrides });
        return {
          document: r.document,
          result: {
            newDuplicateIds: r.created.map((n) => indexPage(r.page).shortId(n)),
            trees: r.created.map((n) => ({
              id: indexPage(r.page).shortId(n),
              code: capCode(elementCode(r.document, r.page, n, 2)),
            })),
          },
        };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.delete_elements = {
    description: "Delete elements and their descendants.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      ids: z.array(elementId).min(1).max(200),
    },
    annotations: { destructiveHint: true },
    run: async ({ document: ref, pageId, ids }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const index = indexPage(page);
        const targets = ids.map((id) => index.require(id));
        let removed = 0;
        for (const node of targets)
          if (page.nodes.includes(node)) removed += removeSubtree(page, node).size;
        return { document, result: { deleted: ids, removedElements: removed } };
      });
      for (const id of ids)
        if (!id.includes(".")) sessionFor(backend).receipts.reset(docKey(out.name, ref), id);
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.rename_elements = {
    description: "Rename element labels (layer names).",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      renames: z
        .array(z.object({ id: elementId, label: z.string().trim().min(1).max(200) }))
        .min(1)
        .max(200),
    },
    run: async ({ document: ref, pageId, renames }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const index = indexPage(page);
        for (const { id, label } of renames) index.require(id).name = label;
        return { document, result: { renamed: renames.map((r) => r.id) } };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  // Components (web/component-core.js): mains, instances and slots. Each tool is one transaction (one undo step in
  // the live editor) and the shared sync keeps every instance in step with its main.
  t.list_components = {
    description:
      "Components of the document: every main component with its slots and instances (on every page), each instance with its override count and slot states (default = shows the main's content, modified = holds its own). With id: the component role of one element (main, instance, inherited layer, slot or local layer), its main and its overrides.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      id: elementId.optional().describe("Describe this element instead of listing"),
    },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, pageId, id }) => {
      const state = await readPrepared(backend, ref);
      const doc = state.document;
      const where = (nodeId) => {
        for (const p of doc.pages) {
          const n = p.nodes.find((x) => x.id === nodeId);
          if (n) return { page: p, node: n };
        }
        return null;
      };
      const short = (nodeId) => {
        const at = where(nodeId);
        return at ? indexPage(at.page).shortId(at.node) : nodeId;
      };
      const slotsOut = (slots) =>
        slots.map((s) => ({
          id: short(s.id),
          name: s.name,
          ...(s.state ? { state: s.state } : {}),
        }));
      if (id) {
        const page = getPage(doc, pageId);
        const node = indexPage(page).require(id);
        const info = componentInfo(doc, node.id);
        if (!info?.role)
          return {
            id,
            role: null,
            note: "Not part of a component. create_component turns it into a main component.",
          };
        return {
          id: short(info.id),
          role: info.role,
          ...(info.mainId
            ? {
                main: {
                  id: short(info.mainId),
                  pageId: where(info.mainId)?.page.id ?? null,
                  name: info.mainName,
                  missing: info.missingMain,
                },
              }
            : {}),
          ...(info.instanceId ? { instance: short(info.instanceId) } : {}),
          ...(info.cyclic ? { cyclic: true } : {}),
          overrides: info.overrides,
          ...(info.role === "instance" ? { overrideCount: info.overrideCount } : {}),
          ...(info.role === "main" ? { instanceCount: info.instanceCount } : {}),
          slots: slotsOut(info.slots),
          ...(info.slot ? { slot: slotsOut([info.slot])[0] } : {}),
        };
      }
      const all = doc.pages.flatMap((page) => page.nodes.map((node) => ({ page, node })));
      const instances = all.filter(
        ({ node }) =>
          typeof node.instanceOf === "string" &&
          node.instanceOf &&
          (!node.sourceId || node.sourceId === node.instanceOf),
      );
      const problems = componentProblems(doc);
      const components = all
        .filter(({ node }) => node.type === "frame" && node.component === true)
        .map(({ page, node }) => {
          const info = componentInfo(doc, node.id);
          return {
            id: indexPage(page).shortId(node),
            pageId: page.id,
            name: node.name,
            slots: slotsOut(info.slots),
            ...(info.cyclic ? { cyclic: true } : {}),
            instances: instances
              .filter((i) => i.node.instanceOf === node.id)
              .map((i) => {
                const ii = componentInfo(doc, i.node.id);
                return {
                  id: indexPage(i.page).shortId(i.node),
                  pageId: i.page.id,
                  name: i.node.name,
                  overrideCount: ii.overrideCount,
                  slots: slotsOut(ii.slots),
                };
              }),
          };
        });
      const orphans = instances
        .filter((i) => where(i.node.instanceOf)?.node.component !== true)
        .map((i) => ({
          id: indexPage(i.page).shortId(i.node),
          pageId: i.page.id,
          name: i.node.name,
          missingMain: i.node.instanceOf,
        }));
      return {
        components,
        ...(orphans.length ? { instancesWithoutMain: orphans } : {}),
        ...(problems.length ? { problems: problems.map((p) => p.message) } : {}),
        ...(components.length
          ? {}
          : {
              note: 'No main components yet. create_component turns a frame (or several layers) into one; get_skills {skill:"components"} explains the workflow.',
            }),
      };
    },
  };
  t.create_component = {
    description:
      "Make a main component. One frame becomes the main in place; several sibling layers (or one non-frame layer) are first wrapped in a new frame. Then place copies that follow it with create_instance, mark content regions with set_slot, and edit the main to change every instance.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      ids: z.array(elementId).min(1).max(100).describe("One frame, or sibling layers to wrap"),
      label: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe('Name of the main (default: the frame\'s name, or "Component" for a wrapper)'),
    },
    run: async ({ document: ref, pageId, ids, label }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const index = indexPage(page);
        const nodes = ids.map((id) => index.require(id));
        const single = new Set(nodes).size === 1 && nodes[0].type === "frame";
        const frame = single
          ? nodes[0]
          : wrapElements(document, page.id, ids, { label: label || "Component" });
        createComponent(document, page.id, frame.id);
        if (label) frame.name = label;
        ensureShortIds(document);
        return {
          document,
          result: {
            id: indexPage(page).shortId(frame),
            pageId: page.id,
            name: frame.name,
            wrapped: !single,
          },
        };
      });
      return {
        ...out.result,
        next: "Mark content regions of the main with set_slot, then place copies with create_instance.",
        live: out.live,
        revision: out.revision,
      };
    },
  };
  t.create_instance = {
    description:
      "Place an instance of a main component: a linked copy that follows the main, keeps its own overrides and holds its own slot content. Returns the instance id and its slot ids; fill a slot with update_elements {/* insert as last child of SLOT_ID */}. Without parent it becomes an artboard (placed right of the others unless x/y are given).",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      component: z
        .string()
        .min(1)
        .max(200)
        .describe('The main: its short id ("bok" or "bok.tem"), long id or exact name'),
      parent: elementId.optional().describe("Frame on pageId to place the instance in"),
      position: z
        .enum(["first", "last"])
        .optional()
        .describe("Child position inside parent (default last)"),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      label: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe("Layer name of the instance (an override)"),
    },
    run: async ({ document: ref, pageId, component, parent, position = "last", x, y, label }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const index = indexPage(page);
        const main = findMain(document, page, component);
        const parentNode = parent ? index.require(parent) : null;
        if (parentNode && parentNode.type !== "frame")
          throw new Error(`${parent} is a ${parentNode.type}; an instance goes inside a frame`);
        const roots = page.nodes.filter((n) => !n.parentId);
        const at = parentNode
          ? { x: x ?? 0, y: y ?? 0 }
          : {
              x:
                x ??
                (roots.length
                  ? Math.ceil(Math.max(...roots.map((n) => (n.x || 0) + (n.w || 0))) + 80)
                  : 0),
              y: y ?? (page.nodes.includes(main) ? main.y || 0 : 0),
            };
        const { id } = createInstance(document, main.id, {
          pageId: page.id,
          parentId: parentNode?.id || null,
          ...at,
        });
        const root = page.nodes.find((n) => n.id === id);
        if (position === "first" && parentNode) {
          page.nodes.splice(page.nodes.indexOf(root), 1);
          const first = page.nodes.findIndex((n) => n.parentId === parentNode.id);
          page.nodes.splice(first < 0 ? page.nodes.length : first, 0, root);
        }
        if (label && label !== root.name) {
          root.name = label;
          root.overrides = [...new Set([...(root.overrides || []), "name"])].sort(byCodeUnit);
        }
        reflow(page, [root], [], document);
        ensureShortIds(document);
        const fresh = indexPage(page);
        const short = (node) => fresh.shortId(node);
        const info = componentInfo(document, id);
        return {
          document,
          result: {
            id: short(root),
            pageId: page.id,
            component: {
              id: indexPage(document.pages.find((p) => p.nodes.includes(main))).shortId(main),
              name: main.name,
            },
            slots: info.slots.map((s) => ({
              id: short(fresh.byId.get(s.id)),
              name: s.name,
              state: s.state,
            })),
            code: capCode(elementCode(document, page, root, 2)),
          },
        };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.detach_instance = {
    description:
      "Detach instances: their layers become ordinary layers that no longer follow the main; slot frames become plain frames and keep their content. Nested instances inside stay instances of their own mains.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      ids: z.array(elementId).min(1).max(50).describe("Instance roots"),
    },
    annotations: { destructiveHint: true },
    run: async ({ document: ref, pageId, ids }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const index = indexPage(page);
        for (const id of ids) {
          const node = index.require(id);
          const info = componentInfo(document, node.id);
          if (info?.role !== "instance")
            throw new Error(
              info?.instanceId
                ? `${id} is inside instance ${index.shortId(index.byId.get(info.instanceId))}; detach that instance`
                : `${id} is not an instance`,
            );
          detachInstance(document, node.id);
        }
        return { document, result: { detached: ids }, reconciled: true };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.reset_overrides = {
    description:
      "Reset overrides inside instances: the given layers (or, with all, their whole instances) take the main's values again. Resetting a slot frame returns the slot to its default content (its own content is removed).",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      ids: z.array(elementId).min(1).max(200).describe("Instance roots or layers inside instances"),
      all: z.boolean().optional().describe("Reset every layer of each instance"),
    },
    run: async ({ document: ref, pageId, ids, all = false }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const index = indexPage(page);
        const nodes = ids.map((id) => index.require(id));
        for (const [i, node] of nodes.entries()) {
          const role = componentInfo(document, node.id)?.role;
          if (
            !["instance", "inherited", "slot"].includes(role) ||
            (role === "slot" && !node.sourceId)
          )
            throw new Error(`${ids[i]} is not part of an instance`);
        }
        const count = all
          ? [...new Set(nodes.map((n) => componentInfo(document, n.id).instanceId))].reduce(
              (sum, rootId) => sum + componentInfo(document, rootId).overrideCount,
              0,
            )
          : nodes.reduce((sum, n) => sum + (n.overrides || []).length, 0);
        resetOverrides(
          document,
          nodes.map((n) => n.id),
          { all },
        );
        return { document, result: { reset: ids, clearedOverrides: count }, reconciled: true };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.set_slot = {
    description:
      "Mark a frame inside a main component as a slot (a content region each instance fills on its own), rename it, or turn it back into a plain frame (slot:false). Instances show the slot's default content until something is inserted into their copy of it.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      id: elementId.describe("Frame inside a main component"),
      slot: z.boolean().optional().describe("false removes the slot (default true)"),
      name: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe('Slot name, e.g. "Content" (default: the frame\'s name)'),
    },
    run: async ({ document: ref, pageId, id, slot = true, name }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const node = indexPage(page).require(id);
        setSlot(document, node.id, slot, name);
        const info = componentInfo(document, node.id);
        return {
          document,
          result: {
            id,
            slot: !!node.slot,
            name: node.slot ? node.slotName || node.name : null,
            ...(info?.mainId ? { main: info.mainName } : {}),
          },
          reconciled: true,
        };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.finish_artboard = {
    description:
      'Finish an artboard after the design review. Requires reviewNote: what the design-review pass checked and what you fixed. Runs the finish gate: refused (isError, nothing focused) while critical lint problems remain; otherwise reports status "verified" (a real screenshot of this artboard at the current revision plus a review note) or "unverified" with reasons. Report the status honestly. On success selects and reveals the artboard in the live editor and returns a verynize:// link.',
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      id: elementId,
      intent: z.enum(["new-design", "faithful-import"]).default("new-design"),
      reviewNote: z
        .string()
        .trim()
        .min(1, "reviewNote is required: describe the design-review pass")
        .max(4000)
        .describe(
          "What the design review checked (hierarchy, spacing, contrast, clipping, placeholders, assets…) and what you fixed",
        ),
    },
    raw: true,
    run: async ({ document: ref, pageId, id, reviewNote, intent = "new-design" }) => {
      const session = sessionFor(backend);
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      const node = index.rootOf(index.require(id));
      const artboardId = index.shortId(node);
      const key = docKey(state.name, ref);
      const revision = state.revision || revisionOf(state.document);
      const cached = session.bounds.get(`${key}\u0000${artboardId}`);
      let lint = null;
      try {
        lint = lintArtboard(state.document, page.id, node.id, {
          bounds: cached?.revision === revision ? cached.bounds : null,
          warnings: session.warnings.get(`${key}\u0000${artboardId}`) || [],
        });
      } catch {}
      const stored = session.receipts.latest(key, artboardId);
      const receipt = stored ? { ...stored, reviewNote } : null;
      const imported = session.imports.get(key);
      const faithful =
        intent === "faithful-import" &&
        imported?.revision === revision &&
        imported.artboardIds.includes(node.id);
      if (intent === "faithful-import" && !faithful)
        throw Error(
          "faithful-import requires an unchanged import from this session; reimport or use new-design.",
        );
      const canWaiveContrast = faithful && !imported.unsupportedFeatures.length;
      const waivers = canWaiveContrast
        ? (lint?.problems || [])
            .filter((p) => p.rule === "contrast")
            .map((p) => ({
              id: p.id,
              node: p.ref,
              rule: p.rule,
              sourceDigest: imported.sourceDigest,
              reason: "Source-preserved contrast",
            }))
        : [];
      const gateLint =
        canWaiveContrast && lint
          ? { ...lint, problems: lint.problems.filter((p) => p.rule !== "contrast") }
          : lint;
      const gate = finishGate({
        receipt,
        currentRevision: revision,
        lint: gateLint,
        budget: faithful ? null : session.receipts.repairBudget(key, artboardId),
        artboardId,
      });
      if (!gate.allowFinish) {
        const budget = faithful
          ? session.receipts.repairBudget(key, artboardId)
          : session.receipts.recordRepair(key, artboardId);
        const fixes = gate.critical.map(
          (p) =>
            `- [${p.rule || "lint"}] ${p.ref || artboardId}: ${p.message || p.id}${p.fix ? ` Fix: ${p.fix}` : ""}`,
        );
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Finish blocked for artboard ${artboardId} (status: blocked).\nReasons:\n${gate.reasons.map((r) => `- ${r}`).join("\n")}\n\nFix these critical problems with update_elements, take_screenshot of ${artboardId} again, then call finish_artboard again:\n${fixes.join("\n")}\n\nRepair round ${budget.used} of ${budget.max}.${!faithful && budget.exhausted ? ' The repair budget is now exhausted: the next finish_artboard will be accepted as "unverified".' : ""}`,
            },
          ],
        };
      }
      if (stored)
        session.receipts.record(
          key,
          createReceipt({
            documentRevision: stored.documentRevision,
            pageId: stored.pageId,
            artboardId,
            screenshot: stored.screenshot,
            reviewNote,
          }),
        );
      // Version history milestone (docs/version-history.md); never blocks finishing.
      await backend.versions
        ?.capture?.(ref, node.id, { reason: "finish", label: "Finished by agent" })
        .catch(() => {});
      const focus =
        state.live && backend.focus
          ? await backend
              .focus(ref, page.id, node.id)
              .catch((error) => ({ focused: false, error: error.message }))
          : { focused: false };
      return text({
        intent,
        renderVerified: gate.status === "verified",
        ...(faithful
          ? {
              sourceDigest: imported.sourceDigest,
              fidelityStatus: imported.unsupportedFeatures.length ? "partial" : "unverified",
              unsupportedFeatures: imported.unsupportedFeatures,
              waivers,
              qualityFindings: lint?.problems || [],
            }
          : {}),
        status: gate.status,
        verified: gate.status === "verified",
        reasons: gate.reasons,
        artboardId,
        lint: lint
          ? {
              critical: lint.stats.critical,
              major: lint.stats.major,
              minor: lint.stats.minor,
              geometry: lint.stats.geometry,
              open: lint.problems
                .filter((p) => p.severity !== "minor")
                .slice(0, 10)
                .map((p) => `${p.ref || artboardId}: ${p.message}`),
            }
          : null,
        headless: !state.live,
        focused: !!focus.focused,
        designLink: {
          name: node.name,
          url: linkFor(state, page.id, artboardId),
          markdown: `[${String(node.name || "Artboard").replace(/[[\]]/g, "")}](${linkFor(state, page.id, artboardId)})`,
        },
        note: `${gate.status === "verified" ? "Verified: screenshot at the current revision plus design review." : "Unverified: tell the user which checks did not happen (see reasons)."} ${state.live ? "The artboard is selected in the editor." : "Saved on disk. Open the document in Verynize to view it."} Include designLink.markdown (or the url) verbatim in your final reply so the user can open the artboard.`,
      });
    },
  };
  // Version history (docs/version-history.md): per-artboard snapshots captured by the backends.
  const versionRow = (meta) => ({
    version: meta.id,
    at: new Date(meta.at).toISOString(),
    author: `${meta.author?.name || "Unknown"} (${meta.author?.kind || "unknown"})`,
    reason: meta.reason,
    summary: meta.summary,
    ...(meta.label ? { label: meta.label } : {}),
  });
  const versionsOf = () => {
    if (!backend.versions) throw new Error("Version history is unavailable for this document");
    return backend.versions;
  };
  t.list_versions = {
    description:
      "Version history of an artboard, newest first: snapshots captured when its editor changes (you, the user, another collaborator), after 2 minutes without edits, before every restore and at finish_artboard. Each row: version id, time, author, reason, summary. Without artboard: the artboards of the page (and deleted ones) that have versions. Restore one with restore_version.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      artboard: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "Artboard short id (or the long id of a deleted artboard from the listing without artboard)",
        ),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, pageId, artboard, limit = 20 }) => {
      const store = versionsOf();
      const state = await readPrepared(backend, ref);
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      if (artboard) {
        const node = index.resolve(artboard);
        const id = node ? index.rootOf(node).id : artboard;
        const list = await store.list(ref, id);
        if (!node && !list.length)
          throw new Error(
            `Artboard ${JSON.stringify(artboard)} not found on page ${page.id} and has no versions`,
          );
        const root = node ? index.rootOf(node) : null;
        return {
          artboard: root ? root.shortId : id,
          name: root ? root.name : list[0].name,
          deleted: !root,
          total: list.length,
          versions: list.slice(0, limit).map(versionRow),
        };
      }
      const all = await store.list(ref, null);
      const byBoard = new Map();
      for (const meta of all) {
        if (!byBoard.has(meta.artboardId)) byBoard.set(meta.artboardId, []);
        byBoard.get(meta.artboardId).push(meta);
      }
      const onPage = new Set(page.nodes.map((n) => n.id));
      const exists = new Set(state.document.pages.flatMap((p) => p.nodes.map((n) => n.id)));
      const artboards = [...byBoard]
        .filter(([id, list]) => onPage.has(id) || (!exists.has(id) && list[0].pageId === page.id))
        .map(([id, list]) => {
          const node = index.byId.get(id);
          return {
            artboard: node ? node.shortId : id,
            name: node ? node.name : list[0].name,
            deleted: !node,
            versions: list.length,
            latest: versionRow(list[0]),
          };
        });
      return {
        pageId: page.id,
        artboards,
        note: artboards.length
          ? "Pass artboard to list its versions."
          : "No versions yet: they are captured as the artboards are edited.",
      };
    },
  };
  t.restore_version = {
    description:
      "Restore an artboard to a version from list_versions. The artboard's subtree is replaced in one undoable edit (re-created when it was deleted; ids used elsewhere are renamed), and the state it replaces is stored as a new version first, so a restore can itself be undone with restore_version. asCopy places the version as a new artboard next to the current one instead.",
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      artboard: z
        .string()
        .min(1)
        .max(200)
        .describe("Artboard short id, or the long id of a deleted artboard"),
      version: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/)
        .describe("Version id from list_versions"),
      asCopy: z.boolean().optional(),
    },
    run: async ({ document: ref, pageId, artboard, version, asCopy = false }) => {
      const store = versionsOf();
      const found = await store.get(ref, version);
      if (!found) throw new Error(`Version ${version} not found; call list_versions`);
      const out = await write(
        backend,
        ref,
        (document) => {
          const page = getPage(document, pageId);
          const index = indexPage(page);
          const node = index.resolve(artboard);
          const id = node ? index.rootOf(node).id : artboard;
          if (id !== found.meta.artboardId)
            throw new Error(
              `Version ${version} belongs to another artboard (${found.meta.name}); call list_versions with artboard ${JSON.stringify(artboard)}`,
            );
          const r = restoreVersion(document, found.snapshot, { asCopy });
          return {
            document: r.document,
            result: { artboardId: r.artboardId, pageId: r.pageId, renamedIds: r.remapped },
          };
        },
        {
          actor: { ...agentActor(context), restore: version },
          force: asCopy ? undefined : "restore",
          artboardId: found.meta.artboardId,
          label: `Before restoring ${new Date(found.meta.at).toISOString()}`,
        },
      );
      const page = getPage((await readPrepared(backend, ref)).document, out.result.pageId);
      const node = indexPage(page).byId.get(out.result.artboardId);
      if (node) sessionFor(backend).receipts.reset(docKey(out.name, ref), node.shortId);
      return {
        restored: version,
        artboard: node?.shortId || out.result.artboardId,
        asCopy,
        renamedIds: out.result.renamedIds,
        note: asCopy
          ? "The version was placed as a new artboard."
          : "The replaced state was saved as a version; restore it to undo.",
        live: out.live,
        revision: out.revision,
      };
    },
  };
  t.get_design_guidelines = {
    description: `The design rules for a job, in this order: the fundamentals that every design follows, then the chosen style (fonts, palette roles, radius, depth, components and signature moves), then the domain playbook with its numbers (domain: landing, web-app, mobile, dashboard, slides…). Styles: ${styleIds.join(", ")}. The older Verynize archetype ids (e.g. ${archetypes
      .slice(0, 3)
      .map((a) => a.id)
      .join(
        ", ",
      )}) are accepted as style too. Without style you get the fundamentals and a pointer to the styles; pass brief to get suggested styles for a free-text brief. Call it before drawing a new design.`,
    inputSchema: {
      style: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe(`Style slug (${styleIds.slice(0, 4).join(", ")}…) or an archetype id`),
      domain: z.string().trim().min(1).max(100).optional().describe("Playbook id or alias"),
      brief: z
        .string()
        .trim()
        .min(1)
        .max(4000)
        .optional()
        .describe("Free-text brief; returns suggested styles"),
    },
    annotations: { readOnlyHint: true },
    run: async ({ style, domain, brief }) => {
      const g = getDesignGuidelines({ style, domain, brief });
      const parts = [];
      if (g.suggestions) {
        parts.push(
          `## Suggested styles for the brief\n${g.suggestions.map((p) => `- ${p.id} (${p.name}): ${p.why}`).join("\n")}${g.archetypeSuggestions?.length ? `\nAlso close (Verynize archetypes): ${g.archetypeSuggestions.map((p) => p.id).join(", ")}.` : ""}${g.styleSection ? "" : `\nCall get_design_guidelines again with style set to your choice${domain ? "" : " and a domain"}.`}`,
        );
      }
      if (g.styleSection)
        parts.push(
          g.styleSection,
          `Apply its colors as tokens with apply_style_tokens {style:"${g.styleId}"}.`,
        );
      if (g.playbook) parts.push(g.playbook);
      if (g.notes.length) parts.push(`## Notes\n${g.notes.map((n) => `- ${n}`).join("\n")}`);
      return parts.length ? `${g.fundamentals}\n\n---\n\n${parts.join("\n\n")}` : g.fundamentals;
    },
  };
  t.get_skills = {
    description:
      "Step-by-step workflows, one per kind of job. Without skill: the catalog. With skill: the full workflow to follow. Primary skills: new-design (anything new, including up to 4 variations), edit-design (change or fix existing work), design-to-code, code-to-design, design-library (tokens, icon set, style guide), generate-assets (imagery without an image model). design-review is required before finish_artboard; other supporting skills are named by the primary ones.",
    inputSchema: {
      skill: z.string().trim().min(1).max(100).optional().describe("Skill name, e.g. new-design"),
      name: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe("Same as skill (older name of this argument)"),
    },
    annotations: { readOnlyHint: true },
    run: async ({ skill, name }) => (skill || name ? getSkill(skill || name) : skillCatalog()),
  };
  t.get_icons = {
    description: `Search the offline icon library (${Object.keys(ICON_SETS).join(", ")}). Returns icon names with a small SVG preview. Use one set per design and place icons with <Icon name="set:name" className="size-5 text-…" />.`,
    inputSchema: {
      query: z.string().trim().min(1).max(200),
      set: z.enum(Object.keys(ICON_SETS)).optional(),
      limit: z.number().int().min(1).max(60).optional(),
    },
    annotations: { readOnlyHint: true },
    run: async ({ query, set, limit = 12 }) => {
      const found = searchIcons(query, { set, limit });
      if (!found.length)
        return {
          query,
          icons: [],
          note: 'No match. Try a simpler noun or verb (e.g. "arrow", "user", "settings").',
        };
      return {
        query,
        set: set || "all",
        icons: found.map((icon) => {
          const svg = resolveIcon(icon.name)?.svg || "";
          return { name: icon.name, preview: svg.length > 600 ? svg.slice(0, 600) + "…" : svg };
        }),
        usage: `<Icon name="${found[0].name}" className="size-5 text-[#111827]" />`,
      };
    },
  };
  t.search_images = {
    description:
      'Search stock photos (Unsplash when configured, otherwise Openverse; can take 30-45 s). Returns candidate URLs with size and attribution. Place a chosen photo with <img src="URL" alt="…" className="w-full h-[480px] object-cover" />; it is downloaded and embedded in the background. Art-direct the query (subject, viewpoint, light, mood) and credit the author where the design shows credits.',
    inputSchema: {
      query: z.string().trim().min(1).max(200),
      orientation: z.enum(["landscape", "portrait", "squarish"]).optional(),
      count: z.number().int().min(1).max(12).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async ({ query, orientation, count = 6 }) => {
      const found = await (backend.searchImages || searchStockPhotos)(query, {
        orientation,
        count,
      });
      const session = sessionFor(backend);
      for (const photo of found.results || [])
        if (photo.source === "unsplash") session.photos.set(photo.url, photo);
      return {
        query,
        source: found.source,
        ...(found.error ? { error: found.error } : {}),
        images: (found.results || []).map((photo) => ({
          url: photo.url,
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
          attribution: attribution(photo),
          pageUrl: photo.pageUrl,
          license: photo.license,
        })),
        note: found.results?.length
          ? 'Use the url in <img src="…">. Pick one that fits the art direction; do not use more photos than the layout needs.'
          : "No photos found. Degrade with intent (gradient mesh, <Shader>, typographic crop) instead of a grey box.",
      };
    },
  };
  t.apply_style_tokens = {
    description: `Create color tokens from a named style (see get_design_guidelines): its palette roles plus any style-specific extra colors (translucent ones keep their alpha). Pass style (${styleIds.join(", ")}) or archetype for an older Verynize archetype id. Existing tokens are kept unless overwrite is true. Also returns the style's fonts, radius and shadow values as Tailwind classes to use directly.`,
    inputSchema: {
      document: documentArg,
      style: z.string().trim().min(1).max(100).optional().describe("Style slug"),
      archetype: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe("Verynize archetype id (older styles)"),
      overwrite: z.boolean().optional(),
    },
    run: async ({ document: ref, style, archetype, overwrite = false }) => {
      const id = style || archetype;
      if (!id)
        throw new Error(
          `Pass style (one of: ${styleIds.join(", ")}) or archetype (one of: ${archetypes.map((a) => a.id).join(", ")}).`,
        );
      const tokens = designTokens(id);
      const out = await write(backend, ref, (document) => {
        const created = [],
          updated = [],
          kept = [];
        for (const token of tokens.colors) {
          checkTokenName(token.name);
          const value = tokenColor(token.value);
          if (Object.hasOwn(document.tokens, token.name)) {
            if (!overwrite) {
              kept.push(token.name);
              continue;
            }
            updated.push(token.name);
          } else created.push(token.name);
          document.tokens[token.name] = value;
        }
        return {
          document,
          result: { created, updated, kept, tokens: describeAllTokens(document) },
        };
      });
      return {
        style: tokens.style,
        kind: tokens.kind,
        ...(tokens.kind === "archetype" ? { archetype: tokens.archetype } : {}),
        ...out.result,
        classes: {
          fonts: tokens.fontFamilies.map((f) => `${f.name}: ${f.tailwind}`),
          radius: tokens.radii.map((r) => `${r.name}: ${r.tailwind}`),
          shadows: tokens.shadows.map((s) => `${s.name}: ${s.tailwind}`),
        },
        live: out.live,
        revision: out.revision,
      };
    },
  };
  t.get_design_tokens = {
    description:
      "List design tokens: colors and typed variables (dimension, number, fontFamily, fontWeight) with their CSS variable names. Colors are used as bg-[var(--…)] / text-[var(--…)]; bind dimension/number/font variables to element properties with bind_variables.",
    inputSchema: {
      document: documentArg,
      type: tokenType.optional().describe("Only tokens of this type"),
      folder: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe('Only tokens inside this slash folder (e.g. "space"), nested folders included'),
    },
    annotations: { readOnlyHint: true },
    run: async ({ document: ref, type, folder }) => {
      const state = await readPrepared(backend, ref);
      const prefix = folder ? folder.replace(/^\/+|\/+$/g, "") + "/" : "";
      return {
        tokens: describeAllTokens(state.document).filter(
          (t) => (!type || t.type === type) && (!prefix || t.name.startsWith(prefix)),
        ),
      };
    },
  };
  t.create_design_tokens = {
    description:
      'Create design tokens (they appear in the Variables panel). type: color (default; hex/rgb value), dimension (pixels, e.g. 16 or "16px"), number (e.g. 1.5), fontFamily (e.g. "Inter") or fontWeight (e.g. "600"). Names may use slashes (color/text/primary -> var(--color-text-primary), radius/md, font/body). Fails if a token exists.',
    inputSchema: {
      document: documentArg,
      tokens: z
        .array(z.object({ name: tokenName, type: tokenType.optional(), value: tokenValue }))
        .min(1)
        .max(200),
    },
    run: async ({ document: ref, tokens }) => {
      const out = await write(backend, ref, (document) => {
        for (const token of tokens) {
          checkTokenName(token.name);
          if (tokenExists(document, token.name))
            throw new Error(`Token ${token.name} already exists; use update_design_tokens`);
          const type = token.type || "color";
          if (type === "color") document.tokens[token.name] = tokenColor(String(token.value));
          else
            document.variables = {
              ...document.variables,
              [token.name]: { type, value: variableValue(type, token.value, token.name) },
            };
        }
        return {
          document,
          result: { created: tokens.map((t) => t.name), tokens: describeAllTokens(document) },
        };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.update_design_tokens = {
    description:
      "Change token values and/or rename tokens (colors and typed variables; the type stays the same: dimension in px, number, fontFamily, fontWeight). Elements bound to a token follow the change. aliasOf makes a token reference another token of the same type (its value follows that token); aliasOf: null or a new value detaches the reference. folders renames slash folders (every variable inside, any type, references follow).",
    inputSchema: {
      document: documentArg,
      tokens: z
        .array(
          z.object({
            name: tokenName,
            newName: tokenName.optional(),
            value: tokenValue.optional(),
            aliasOf: tokenName.nullable().optional(),
          }),
        )
        .max(200)
        .optional(),
      folders: z
        .array(z.object({ name: tokenName, newName: tokenName }))
        .max(50)
        .optional(),
    },
    run: async ({ document: ref, tokens = [], folders = [] }) => {
      if (!tokens.length && !folders.length)
        throw new Error("Provide tokens and/or folders to update");
      const out = await write(backend, ref, (document) => {
        for (const token of tokens) {
          const isColor = Object.hasOwn(document.tokens, token.name),
            variable = document.variables?.[token.name];
          if (!isColor && !variable) throw new Error(`Token ${token.name} does not exist`);
          if (token.value !== undefined) {
            detachAlias(document, token.name);
            if (isColor) document.tokens[token.name] = tokenColor(String(token.value));
            else variable.value = variableValue(variable.type, token.value, token.name);
          }
          if (token.aliasOf === null) detachAlias(document, token.name);
          else if (token.aliasOf !== undefined) setAlias(document, token.name, token.aliasOf);
          if (token.newName && token.newName !== token.name) {
            checkTokenName(token.newName);
            if (tokenExists(document, token.newName))
              throw new Error(`Token ${token.newName} already exists`);
            moveToken(document, token.name, token.newName);
          }
        }
        for (const folder of folders) renameTokenFolder(document, folder.name, folder.newName); // after token edits
        return {
          document,
          result: {
            updated: [
              ...folders.map((f) => f.newName + "/"),
              ...tokens.map((t) => t.newName || t.name),
            ],
            tokens: describeAllTokens(document),
          },
        };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.delete_design_tokens = {
    description:
      "Delete tokens (colors or typed variables), or whole slash folders. Bound elements keep the current value as a plain value.",
    inputSchema: {
      document: documentArg,
      names: z.array(tokenName).max(200).optional(),
      folders: z.array(tokenName).max(50).optional(),
    },
    annotations: { destructiveHint: true },
    run: async ({ document: ref, names = [], folders = [] }) => {
      if (!names.length && !folders.length)
        throw new Error("Provide names and/or folders to delete");
      const out = await write(backend, ref, (document) => {
        for (const folder of folders) {
          const members = folderMembers(document, folder.replace(/^\/+|\/+$/g, ""));
          if (!members.length) throw new Error(`Folder ${folder} has no variables`);
          names = [...names, ...members.filter((n) => !names.includes(n))];
        }
        for (const name of names) {
          if (Object.hasOwn(document.tokens, name)) {
            unbindToken(document, name);
            delete document.tokens[name];
          } else if (Object.hasOwn(document.variables || {}, name)) {
            unbindVariable(document, name);
            delete document.variables[name];
            if (!Object.keys(document.variables).length) delete document.variables;
          } else throw new Error(`Token ${name} does not exist`);
        }
        return { document, result: { deleted: names, tokens: describeAllTokens(document) } };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.bind_variables = {
    description: `Bind element properties to tokens so they follow the token (shown as bound in the inspector). Typed properties: ${Object.entries(
      BINDABLE,
    )
      .map(([k, types]) => `${k} (${types.join("/")})`)
      .join(
        ", ",
      )}. Color properties (color tokens): ${Object.keys(COLOR_BINDINGS).join(", ")}. Set token to null to unbind (the element keeps its current value). Text and background colors can also use bg-[var(--…)] / text-[var(--…)] classes.`,
    inputSchema: {
      document: documentArg,
      pageId: pageArg,
      bindings: z
        .array(
          z.object({
            id: elementId,
            property: z.enum([...Object.keys(BINDABLE), ...Object.keys(COLOR_BINDINGS)]),
            token: tokenName.nullable(),
          }),
        )
        .min(1)
        .max(500),
    },
    run: async ({ document: ref, pageId, bindings }) => {
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId),
          index = indexPage(page);
        for (const { id, property, token } of bindings) {
          const node = index.require(id);
          if (Object.hasOwn(COLOR_BINDINGS, property)) {
            bindColor(document, node, property, token);
            continue;
          }
          if (token === null) {
            if (node.bindings) {
              delete node.bindings[property];
              if (!Object.keys(node.bindings).length) delete node.bindings;
            }
            continue;
          }
          const variable = document.variables?.[token];
          if (!variable)
            throw new Error(
              Object.hasOwn(document.tokens, token)
                ? `${token} is a color token; use bg-[var(--…)] / text-[var(--…)] classes for colors`
                : `Token ${token} does not exist; create it with create_design_tokens`,
            );
          if (!BINDABLE[property].includes(variable.type))
            throw new Error(
              `${property} takes a ${BINDABLE[property].join(" or ")} token; ${token} is ${variable.type}`,
            );
          node.bindings = { ...node.bindings, [property]: token };
        }
        return {
          document,
          result: {
            bound: bindings.filter((b) => b.token !== null).length,
            unbound: bindings.filter((b) => b.token === null).length,
          },
        };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.list_documents = {
    description:
      "List saved documents and, when the desktop app is running, the document open in the editor.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    run: async () => backend.list(),
  };
  t.open_document = {
    description:
      "Open a saved document (by name) or an editor library file (by fileId) in the desktop editor. Requires the live desktop app.",
    inputSchema: { name: docName.optional(), fileId: z.string().min(1).max(200).optional() },
    run: async ({ name, fileId }) => {
      if (!name === !fileId) throw new Error("Provide exactly one of name or fileId");
      if (!backend.open)
        throw new Error(
          'open_document needs the Verynize desktop app running; headless mode edits saved documents directly by passing "document"',
        );
      return backend.open({ name, fileId });
    },
  };
  t.create_document = {
    description:
      "Create a new empty saved document (refuses to overwrite). In the live app it also opens in the editor unless open is false.",
    inputSchema: {
      name: docName,
      title: z.string().trim().min(1).max(200),
      open: z.boolean().optional(),
    },
    run: async ({ name, title, open = true }) => backend.create(name, title, { open }),
  };
  t.create_page = {
    description: "Add a page to a document and return its id.",
    inputSchema: { document: documentArg, name: pageName },
    run: async ({ document: ref, name }) => {
      let id;
      const out = await write(backend, ref, (document) => {
        id = randomUUID();
        document.pages.push({ id, name, nodes: [] });
        return { document, result: { pageId: id, name } };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.rename_page = {
    description: "Rename a page.",
    inputSchema: { document: documentArg, pageId: z.string().min(1).max(200), name: pageName },
    run: async ({ document: ref, pageId, name }) => {
      const out = await write(backend, ref, (document) => {
        getPage(document, pageId).name = name;
        return { document, result: { pageId, name } };
      });
      return { ...out.result, live: out.live, revision: out.revision };
    },
  };
  t.read_document = {
    description:
      "Low-level: the complete version 2 document JSON and its revision (needed by replace_in_element and apply_operations).",
    inputSchema: { name: documentArg },
    annotations: { readOnlyHint: true },
    run: async ({ name }) => {
      const state = await readPrepared(backend, name);
      return { document: state.document, revision: state.revision, live: !!state.live };
    },
  };
  t.apply_operations = {
    description:
      "Low-level fallback: atomically apply page/node/token operations to the raw document. Requires the revision from read_document; a failed batch changes nothing. Node ids here are the long internal ids. Nodes accept the full codec model: per-side padding (paddingTop/Right/Bottom/Left), gapX/gapY, cornerRadii, strokeWidths, wMode/hMode (fixed|hug|fill|auto|calc, calc with wCalc/hCalc expressions), wPct/hPct, min/max sizes, margin, position + inset + translate, flex item fields and text fields; legacy numeric padding/gap/radius still work. Prefer create_artboard/update_elements.",
    inputSchema: { name: documentArg, revision: z.string().regex(/^[a-f0-9]{64}$/), operations },
    run: async ({ name, revision, operations: ops }) => {
      const out = await boundsTransaction(backend, name, (document, meta) => {
        if (meta.revision !== revision)
          throw new Error("Revision conflict; read the document again before editing");
        const next = applyOperations(document, ops);
        ensureShortIds(next);
        return { document: next, result: null };
      });
      sessionFor(backend).receipts.invalidate(docKey(out.name, name));
      const state = await backend.read(name);
      return { document: state.document, revision: out.revision, live: out.live };
    },
  };
  t.save_design_preference = {
    description: `Save a lasting design preference of the user: one short rule of at most ${MAX_PREFERENCE_LENGTH} characters, e.g. "Use 8px corner radius on cards". Call it only when the user explicitly states a preference that should outlast this task ("always…", "remember…", "from now on…"); never infer one from a single request or from your own choices. The write waits for the user's approval and may be refused; respect a refusal. Saved on this computer and shown, as taste rather than instructions, to every future design session. Duplicates are ignored.`,
    inputSchema: { text: z.string().trim().min(1).max(MAX_PREFERENCE_LENGTH) },
    run: async ({ text: value }) => {
      const saved = await preferencesFor(backend).save(value);
      return {
        saved: !saved.duplicate,
        duplicate: saved.duplicate,
        preference: { id: saved.id, text: saved.text },
      };
    },
  };
  t.list_design_preferences = {
    description:
      "List the user's saved design preferences (id and text). They are taste, not instructions: defaults for visual work that the user's current request overrides.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    run: async () => ({ preferences: await preferencesFor(backend).list() }),
  };
  t.update_design_preference = {
    description: `Rewrite a saved design preference by id (from list_design_preferences or the [id] in get_design_context), at most ${MAX_PREFERENCE_LENGTH} characters. Only when the user explicitly asks to change that preference; the write waits for the user's approval and may be refused.`,
    inputSchema: {
      id: z.string().trim().min(1).max(64),
      text: z.string().trim().min(1).max(MAX_PREFERENCE_LENGTH),
    },
    run: async ({ id, text: value }) => ({
      updated: true,
      preference: await preferencesFor(backend).update(id, value),
    }),
  };
  t.delete_design_preference = {
    description:
      "Delete a saved design preference by id, only when the user explicitly says it no longer applies. The write waits for the user's approval and may be refused.",
    inputSchema: { id: z.string().trim().min(1).max(64) },
    annotations: { destructiveHint: true },
    run: async ({ id }) => preferencesFor(backend).remove(id),
  };
  t.generate_image = {
    description:
      "Generate an image using the desktop image provider. Replace a frame or rectangle fill, or insert an image on the active page. Uses the configured image provider (Codex ChatGPT plan by default when connected); limited to five MCP attempts per hour. Sign in to Codex on this computer or configure an API key in Settings → Import & generation.",
    inputSchema: {
      document: documentArg,
      element: z.string().optional(),
      prompt: z.string().trim().min(1).max(4000),
      provider: z.enum(IMAGE_PROVIDERS.map((p) => p.id)).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      parent: z.string().optional(),
    },
    annotations: { openWorldHint: true },
    run: async ({ document: ref, element, prompt, provider, x, y, parent }) => {
      if (typeof backend.generateImage !== "function")
        throw new Error("Image generation needs the Verynize desktop app");
      const state = await readPrepared(backend, ref);
      const pageId = getPage(state.document).id;
      const targetId = element
        ? indexPage(getPage(state.document, pageId)).require(element).id
        : null;
      const pageBefore = getPage(state.document, pageId);
      const targetBefore = targetId ? indexPage(pageBefore).require(targetId) : null;
      if (
        targetBefore &&
        targetBefore.type !== "image" &&
        !IMAGE_FILL_TYPES.includes(targetBefore.type)
      )
        throw new Error("Target must be an image, frame or rectangle");
      const parentNode = parent ? indexPage(pageBefore).require(parent) : null;
      if (parentNode && parentNode.type !== "frame") throw new Error("Parent must be a frame");
      const image = await backend.generateImage({ prompt, provider });
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const target = targetId ? indexPage(page).require(targetId) : null;
        let node;
        if (target && IMAGE_FILL_TYPES.includes(target.type)) {
          target.fills = [
            {
              type: "image",
              src: image.src,
              fit: "cover",
              imageWidth: image.width,
              imageHeight: image.height,
            },
          ];
          node = target;
        } else if (target?.type === "image") {
          target.src = image.src;
          node = target;
        } else {
          const scale = Math.min(1, 512 / Math.max(image.width, image.height));
          node = {
            id: randomUUID(),
            type: "image",
            name: "Generated image",
            parentId: parentNode?.id ?? null,
            x:
              x ??
              (parentNode
                ? 0
                : Math.max(
                    0,
                    ...page.nodes.filter((n) => !n.parentId).map((n) => (n.x || 0) + (n.w || 0)),
                  ) + 40),
            y: y ?? 0,
            w: image.width * scale,
            h: image.height * scale,
            src: image.src,
          };
          page.nodes.push(node);
        }
        ensureShortIds(document);
        return {
          document,
          result: { element: indexPage(page).shortId(node), pageId, filled: node === target },
        };
      });
      return { ...out.result, revision: out.revision, live: out.live };
    },
  };
  t.ask_agent = {
    description:
      "Get a second opinion or design review from another agent (Claude or Codex) running in the Verynize desktop app. Read-only: the other agent answers in text and cannot edit the canvas. Put everything it needs in task (the brief, what you built, element code or ids, the question). Use it sparingly, e.g. to critique a finished artboard before finish_artboard. Unavailable in headless mode.",
    inputSchema: {
      agent: z
        .enum(["claude", "codex"])
        .optional()
        .describe("Which agent to ask; defaults to the other agent"),
      task: z
        .string()
        .trim()
        .min(1)
        .max(20000)
        .describe("The question or review request, with all needed context"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async ({ agent, task }) => {
      if (typeof backend.askAgent !== "function")
        throw new Error(
          "ask_agent is unavailable in headless mode: it needs the Verynize desktop app (which runs the other agent). Continue with your own design-review skill instead.",
        );
      const answer = await backend.askAgent({ agent, task });
      const reply = typeof answer === "string" ? { text: answer } : answer || {};
      if (!reply.text) throw new Error("The other agent returned no answer");
      return {
        agent: reply.agent || agent || null,
        model: reply.model || null,
        text: String(reply.text),
      };
    },
  };
  t.export_document = {
    description:
      "Export one page as standalone HTML (returned as text; nothing is written to disk). Shader nodes include only the app-authored WebGL runtime.",
    inputSchema: { name: documentArg, pageId: pageArg },
    annotations: { readOnlyHint: true },
    run: async ({ name, pageId }) => {
      const state = await backend.read(name);
      return {
        html: await inlineAssets(
          exportHTML(state.document, pageId),
          backend.assets ? (asset) => backend.assets.get(name, asset) : null,
        ),
        revision: state.revision,
      };
    },
  };
  // Source round trips (integrations/codec-source.mjs, codec-html.mjs): lossless exports and imports.
  t.export_css = {
    description:
      "Export one page as HTML with a class-based stylesheet (CSS variables in :root). Lossless: import_html reads it back exactly; layers whose CSS was edited are rebuilt from their declarations.",
    inputSchema: { name: documentArg, pageId: pageArg },
    annotations: { readOnlyHint: true },
    run: async ({ name, pageId }) => {
      const state = await backend.read(name);
      return {
        html: await inlineAssets(
          documentToHtml(state.document, pageId),
          backend.assets ? (asset) => backend.assets.get(name, asset) : null,
        ),
        revision: state.revision,
      };
    },
  };
  t.export_jsx = {
    description:
      "Export every artboard of a page as Tailwind JSX with a header carrying variables and page settings. Lossless: import_jsx reads it back exactly.",
    inputSchema: { name: documentArg, pageId: pageArg },
    annotations: { readOnlyHint: true },
    run: async ({ name, pageId }) => {
      const state = await backend.read(name);
      return {
        code: await inlineAssets(
          documentToJsx(state.document, pageId),
          backend.assets ? (asset) => backend.assets.get(name, asset) : null,
        ),
        revision: state.revision,
      };
    },
  };
  const viewportArg = z
    .object({
      width: z.number().int().min(200).max(8000),
      height: z.number().int().min(200).max(8000),
      colorScheme: z.enum(["light", "dark"]).optional(),
    })
    .strict()
    .optional()
    .describe(
      "Viewport for @media, vw/vh and responsive Tailwind variants (default 1440x900, light)",
    );
  const importOptions = {
    split: z
      .enum(["pages", "none"])
      .optional()
      .describe(
        "pages (default) distributes whole artboards across pages; none fails atomically on page overflow",
      ),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Artboard name; defaults to title, file basename, or a unique Imported page N"),
    placement: z
      .enum(["auto", "preserve"])
      .optional()
      .describe(
        "auto (default) places new roots beside existing roots; preserve keeps source coordinates",
      ),
  };
  t.import_pen = {
    description:
      "Import supported unencrypted Pen JSON (versions 1.0/2.8). Preserves components and instances, reports unsupported features; never decrypts files.",
    inputSchema: { document: documentArg, path: z.string().max(4096) },
    run: async ({ document: ref, path: file }) => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      if (!path.isAbsolute(file)) throw Error("Pen path must be absolute");
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 5_000_000)
        throw Error("Pen source exceeds limit 5000000 bytes");
      const { importPen } = await import("./codec-pen.mjs");
      const imported = await importPen(await fs.readFile(file), {
        assetSink: backend.assets
          ? (bytes, type) => backend.assets.put(ref, bytes, type)
          : undefined,
        name: path.basename(file, ".pen"),
      });
      const out = await write(backend, ref, (document) => {
        document.pages.push(...imported.document.pages);
        return { document, result: null };
      });
      sessionFor(backend).imports.set(docKey(out.name, ref), {
        revision: out.revision,
        sourceDigest: imported.sourceDigest,
        artboardIds: imported.document.pages.flatMap((p) =>
          p.nodes.filter((n) => !n.parentId).map((n) => n.id),
        ),
        unsupportedFeatures: imported.unsupportedFeatures,
      });
      return {
        pages: imported.document.pages.map((p) => p.id),
        sourceDigest: imported.sourceDigest,
        unsupportedFeatures: imported.unsupportedFeatures,
        fidelityStatus: imported.fidelityStatus,
        counts: imported.counts,
        revision: out.revision,
      };
    },
  };
  t.preflight_import = {
    description:
      "Read-only HTML/Pen capacity check. Counts UTF-8 bytes and nodes, reports exceeded limits. Local HTML resolves sibling assets without a server.",
    inputSchema: { format: z.enum(["html", "pen"]), path: z.string().max(4096) },
    annotations: { readOnlyHint: true },
    run: async ({ format, path: file }) => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      if (!path.isAbsolute(file)) throw Error("Import path must be absolute");
      const info = await fs.stat(file);
      if (!info.isFile()) throw Error("Import path must be a file");
      if (info.size > 5_000_000)
        return {
          ok: false,
          exceeded: { budget: "source", bytes: info.size, limitBytes: 5_000_000 },
        };
      try {
        const source = await fs.readFile(file);
        const staged = new Map();
        const assetSink = async (bytes, type) => {
          const asset = prepareAsset(bytes, type);
          staged.set(asset.ref, asset.size);
          const { bytes: _bytes, ...meta } = asset;
          return meta;
        };
        const result =
          format === "pen"
            ? await (await import("./codec-pen.mjs")).importPen(source, { assetSink })
            : await (
                await import("./codec-html.mjs")
              ).importHtml(source.toString("utf8"), {
                baseUrl: file,
                root: path.dirname(file),
                allowFiles: true,
                assetSink,
              });
        return {
          ok: true,
          uniqueAssets: staged.size,
          decodedAssetBytes: [...staged.values()].reduce((a, b) => a + b, 0),
          sourceBytes: source.length,
          documentBytes: Buffer.byteLength(JSON.stringify(result.document)),
          nodes: result.document.pages.reduce((n, p) => n + p.nodes.length, 0),
          warnings: result.warnings || result.unsupportedFeatures || [],
          limitBytes: 5_000_000,
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  };
  t.upload_asset = {
    description:
      "Store an image/font once by SHA-256. Returns asset:<hash>; local path must be absolute. No binary in the response.",
    inputSchema: {
      document: documentArg,
      path: z.string().max(4096),
      contentType: z.string().max(100).optional(),
    },
    run: async ({ document: ref, path: file, contentType }) => {
      if (!backend.assets) throw Error("This backend does not support local asset uploads");
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      if (!path.isAbsolute(file)) throw Error("Asset path must be absolute");
      const h = await fs.open(file, "r");
      try {
        const stat = await h.stat();
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
          throw Error("Asset exceeds limit 4194304 bytes");
        return await backend.assets.put(ref, await h.readFile(), contentType);
      } finally {
        await h.close();
      }
    },
  };
  t.import_html = {
    description:
      "Import HTML as new artboards: inline html, a local .html file path (its <link>/@import stylesheets and images resolve relative to it, inside its folder), or an http(s) url (needs allowRemote). Computes the CSS cascade for the viewport, turns :root custom properties into colour tokens and typed variables, keeps Tailwind classes. Also reads export_css output losslessly. Supports sanitized inline SVG and URL backgrounds. allowRemote explicitly permits local HTTP images for this local HTML import. Returns warnings for unavailable images and CSS that has no canvas equivalent.",
    inputSchema: {
      ...importOptions,
      document: documentArg,
      pageId: pageArg,
      html: z
        .string()
        .min(1)
        .refine(
          (source) => Buffer.byteLength(source, "utf8") <= 5_000_000,
          "HTML source exceeds limit 5000000 bytes",
        )
        .optional(),
      path: z.string().min(1).max(4096).optional(),
      url: z.string().url().max(4096).optional(),
      viewport: viewportArg,
      allowRemote: z
        .boolean()
        .optional()
        .describe("Fetch http(s) stylesheets and images (default false)"),
    },
    run: async ({
      document: ref,
      pageId,
      html,
      path: file,
      url,
      viewport,
      allowRemote = false,
      name,
      placement = "auto",
      split = "pages",
    }) => {
      if ([html, file, url].filter((v) => v !== undefined).length !== 1)
        throw new Error("Pass exactly one of html, path or url");
      const { readFile, stat } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      let source = html,
        baseUrl,
        root;
      if (file !== undefined) {
        if (!nodePath.isAbsolute(file)) throw new Error("path must be absolute");
        const info = await stat(file);
        if (!info.isFile() || info.size > 5_000_000)
          throw new Error("HTML source exceeds limit 5000000 bytes");
        source = await readFile(file, "utf8");
        baseUrl = file;
        root = nodePath.dirname(file);
      }
      if (url !== undefined) {
        if (!allowRemote) throw new Error("Importing from a url needs allowRemote: true");
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        if (Number(res.headers.get("content-length")) > 5_000_000)
          throw new Error("HTML source exceeds limit 5000000 bytes");
        const chunks = [];
        let received = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > 5_000_000) {
            await reader.cancel();
            throw Error("HTML source exceeds limit 5000000 bytes");
          }
          chunks.push(Buffer.from(value));
        }
        source = Buffer.concat(chunks).toString("utf8");
        baseUrl = res.url || url;
      }
      const state = await backend.read(ref);
      const page = getPage(state.document, pageId);
      const prepared = await prepareHtmlImport(source, state.document, page.id, {
        assetSink: backend.assets
          ? (bytes, type) => backend.assets.put(ref, bytes, type)
          : undefined,
        baseUrl,
        root,
        allowFiles: file !== undefined,
        allowRemote,
        viewport,
        name,
        fallbackName: file ? nodePath.basename(file, nodePath.extname(file)) : undefined,
        placement,
        split,
      });
      let created = [],
        appliedWarnings = [],
        pages = [];
      const out = await write(backend, ref, (document) => {
        const r = prepared.apply(document);
        appliedWarnings = r.warnings;
        pages = r.pages;
        created = pages.flatMap((p) => p.artboards.map((a) => a.id));
        return { document: r.document, result: null };
      });
      sessionFor(backend).imports.set(docKey(out.name, ref), {
        revision: out.revision,
        sourceDigest: createHash("sha256").update(source).digest("hex"),
        artboardIds: created,
        unsupportedFeatures: prepared.warnings,
      });
      const warnings = warningText([
        ...new Set([
          ...prepared.warnings.filter((w) => !w.startsWith("Image pending:")),
          ...appliedWarnings,
          ...(await imageWarnings(backend, ref, out)),
        ]),
      ]);
      return {
        artboards: created,
        pages,
        stats: {
          elements: prepared.stats.elements,
          stylesheets: prepared.stats.stylesheets,
          rules: prepared.stats.rules,
          prunedRules: prepared.stats.prunedRules,
          tokens: prepared.stats.tokens,
          variables: prepared.stats.variables,
          bindings: prepared.stats.bindings,
          restored: prepared.stats.restored,
        },
        ...(warnings.length ? { WARNINGS: warnings } : { warnings: [] }),
        live: out.live,
        revision: out.revision,
      };
    },
  };
  t.import_jsx = {
    description:
      "Import Tailwind JSX with any number of root elements as new artboards: export_jsx output, an exported React component (Code export), or create_artboard JSX. Variables in the @verynize header are added when missing.",
    inputSchema: {
      ...importOptions,
      document: documentArg,
      pageId: pageArg,
      code: z
        .string()
        .min(1)
        .refine(
          (source) => Buffer.byteLength(source, "utf8") <= 5_000_000,
          "JSX source exceeds limit 5000000 bytes",
        ),
      viewport: viewportArg,
    },
    run: async ({
      document: ref,
      pageId,
      code,
      viewport,
      name,
      placement = "auto",
      split = "pages",
    }) => {
      let created = [],
        warnings = [],
        pages = [];
      const out = await write(backend, ref, (document) => {
        const r = importJsxInto(document, getPage(document, pageId).id, code, {
          viewport: viewport || null,
          name,
          placement,
          split,
        });
        pages = r.pages;
        created = pages.flatMap((p) => p.artboards.map((a) => a.id));
        warnings = warningText(r.warnings || []);
        return { document: r.document, result: null };
      });
      warnings.push(...(await imageWarnings(backend, ref, out)));
      return {
        artboards: created,
        pages,
        ...(warnings.length ? { WARNINGS: warnings } : { warnings: [] }),
        live: out.live,
        revision: out.revision,
      };
    },
  };
  Object.assign(
    t,
    shellToolTable(backend, context, {
      readPrepared,
      write,
      getPage,
      indexPage,
      invalidate: (name) => sessionFor(backend).receipts.invalidate(docKey(name)),
    }),
  );
  attachToolHints(t, {
    read: (ref) => readPrepared(backend, ref),
    session: sessionFor(backend),
    keyOf: docKey,
  });
  return t;
}

export const TOOL_NAMES = Object.keys(toolTable({}));

/**
 * Register every tool on an McpServer. Pass {backend} to execute locally, or {forward} to relay
 * each validated call to another server (the stdio proxy uses this).
 */
export function registerDesignTools(server, { backend, forward, context }) {
  const table = toolTable(backend || {}, {
    ...context,
    clientName: () => server.server?.getClientVersion?.()?.name,
  });
  for (const [name, tool] of Object.entries(table)) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        try {
          return forward ? await forward(name, args || {}) : await execute(tool, args || {});
        } catch (error) {
          return failure(error);
        }
      },
    );
  }
  return server;
}

async function execute(tool, args) {
  const result = await tool.run(args);
  if (tool.raw && result && Array.isArray(result.content)) return result;
  return text(result);
}

/** Run one tool directly against a backend (arguments are validated with the tool's schema). */
export async function runTool(backend, name, args = {}) {
  const tool = toolTable(backend)[name];
  if (!tool) return failure(new Error(`Unknown tool ${name}`));
  try {
    const parsed = z.object(tool.inputSchema).strict().safeParse(args);
    if (!parsed.success)
      return failure(
        new Error(
          `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`,
        ),
      );
    return await execute(tool, parsed.data);
  } catch (error) {
    return failure(error);
  }
}

export function createDesignServer(options, { instructions = INSTRUCTIONS } = {}) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions });
  return registerDesignTools(server, options);
}

// ---------------------------------------------------------------------------------------------
// Store (on-disk) backend

export function createStoreBackend(
  store,
  {
    screenshot,
    defaultName,
    fetchImage,
    searchImages,
    preferences,
    askAgent,
    generateImage,
    agentName = "Agent",
  } = {},
) {
  const resolveName = async (ref) => {
    if (ref) return ref;
    if (defaultName) return defaultName;
    const names = await store.list();
    if (names.length === 1) return names[0];
    throw new Error(
      names.length
        ? `Pass "document" to choose one of: ${names.slice(0, 50).join(", ")}`
        : "No documents yet; call create_document first",
    );
  };
  return {
    mode: "headless",
    assets: {
      async put(ref, bytes, type) {
        return sidecarAssets(store.file(await resolveName(ref))).put(bytes, type);
      },
      async get(ref, asset) {
        return sidecarAssets(store.file(await resolveName(ref))).get(asset);
      },
    },
    async list() {
      const names = await store.list();
      const documents = [];
      for (const name of names.slice(0, 500)) {
        try {
          const { document } = await store.read(name);
          documents.push({ name, title: document.name, pages: document.pages.length, live: false });
        } catch (error) {
          documents.push({ name, error: error.message, live: false });
        }
      }
      return { documents, editor: null, headless: true };
    },
    async read(ref) {
      const name = await resolveName(ref);
      const state = await store.read(name);
      return { ...state, name, live: false, selection: [] };
    },
    async transact(ref, fn, options = {}) {
      const name = await resolveName(ref);
      let result;
      let saved, before;
      for (let attempt = 0; ; attempt++) {
        try {
          saved = await store.mutate(name, async () => {
            const current = await store.read(name);
            before = current.document;
            const out = fn(clone(current.document), { revision: current.revision });
            validateWorldBoundsChange(before, out.document);
            result = out.result;
            return out.document;
          });
          break;
        } catch (error) {
          if (!/Document is locked/.test(error.message) || attempt >= 40) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 5));
        }
      }
      // Version history sidecar (integrations/version-store.mjs); history problems never fail an edit.
      await sidecarFor(store.file(name))
        .observe(
          before,
          saved.document,
          { kind: "agent", name: agentName, ...options.actor },
          { force: options.force, artboardId: options.artboardId, label: options.label },
        )
        .catch(() => {});
      return { result, revision: saved.revision, live: false, name };
    },
    versions: {
      list: async (ref, artboardId) =>
        sidecarFor(store.file(await resolveName(ref))).list(artboardId),
      get: async (ref, id) => sidecarFor(store.file(await resolveName(ref))).get(id),
      async capture(ref, artboardId, { reason = "manual", label, actor } = {}) {
        const name = await resolveName(ref);
        const { document } = await store.read(name);
        return sidecarFor(store.file(name)).observe(
          document,
          document,
          { kind: "agent", name: agentName, ...actor },
          { force: reason === "finish" ? "finish" : "manual", artboardId, label },
        );
      },
    },
    async create(name, title) {
      const state = await store.create(name, title);
      return {
        name,
        title,
        pageId: state.document.pages[0].id,
        revision: state.revision,
        live: false,
        opened: false,
      };
    },
    screenshot: screenshot
      ? async (ref, pageId, nodeId, scale, state) =>
          screenshot(state.document, pageId, nodeId, scale)
      : undefined,
    ...(fetchImage ? { fetchImage } : {}),
    ...(searchImages ? { searchImages } : {}),
    ...(preferences ? { preferences } : {}),
    ...(askAgent ? { askAgent } : {}),
    ...(generateImage ? { generateImage } : {}),
  };
}
