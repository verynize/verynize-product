// Necessary-condition pruning only: never guesses about pseudos, attributes, or ancestry.
// A deadline retains all remaining rules, preserving cascade behavior under load.
export function pruneImportRules(rules, elements, budgetMs = 50) {
  const start = performance.now();
  const tags = new Set(),
    ids = new Set(),
    classes = new Set();
  for (const el of elements) {
    tags.add(el.tag);
    if (el.attrs?.id) ids.add(el.attrs.id);
    for (const cls of el.classList || []) classes.add(cls);
  }
  return rules.filter((rule) => {
    if (performance.now() - start > budgetMs) return true;
    return rule.selectors.some(
      (selector) =>
        !selector ||
        selector.parts.every(
          ({ compound: c }) =>
            (!c.tag || tags.has(c.tag)) &&
            (!c.id || ids.has(c.id)) &&
            c.classes.every((cls) => classes.has(cls)),
        ),
    );
  });
}
