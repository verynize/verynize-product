import {
  clone,
  getPage,
  indexPage,
  elementCode,
  applyDirective,
  ensureShortIds,
} from "./design-edit.mjs";
import { parseJsx } from "./jsx-codec.mjs";

// Capture everything outside the addressed subtree, including document/page metadata.
export function outsideElement(document, pageId, ids) {
  const copy = clone(document);
  getPage(copy, pageId).nodes = getPage(copy, pageId).nodes.filter((node) => !ids.has(node.id));
  return JSON.stringify(copy);
}

export function replaceInElement(document, pageId, id, old, replacement) {
  const working = clone(document);
  ensureShortIds(working);
  const page = getPage(working, pageId);
  const index = indexPage(page);
  const target = index.require(id);
  const ids = new Set([target, ...index.descendants(target.id)].map((node) => node.id));
  const outside = outsideElement(working, page.id, ids);
  const code = elementCode(working, page, target);
  if (!old) throw new Error("old must not be empty");
  let count = 0;
  for (let pos = code.indexOf(old); pos !== -1; pos = code.indexOf(old, pos + 1)) count++;
  if (count !== 1) {
    const pos = Math.max(0, code.indexOf(old));
    throw new Error(
      `old matched ${count} times; expected exactly 1. Context: ${JSON.stringify(code.slice(Math.max(0, pos - 40), pos + 160))}`,
    );
  }
  const next = code.replace(old, () => replacement);
  const parsed = parseJsx(next);
  if (parsed.elements.length !== 1 || parsed.imports.length)
    throw new Error("Replacement must contain exactly one JSX element and no imports");
  const warnings = [];
  applyDirective(working, page, { kind: "replace", target: id, body: next }, warnings);
  ensureShortIds(working);
  const freshIndex = indexPage(page);
  const fresh = freshIndex.require(target.id);
  const nextIds = new Set([fresh, ...freshIndex.descendants(fresh.id)].map((node) => node.id));
  const guard = (after) => {
    if (outsideElement(after, page.id, nextIds) !== outside)
      throw new Error("Replacement would alter content outside the element; nothing changed");
  };
  guard(working);
  return {
    document: working,
    guard,
    result: { id: freshIndex.shortId(fresh), code: elementCode(working, page, fresh), warnings },
  };
}
