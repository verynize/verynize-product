const test = require("node:test");
const assert = require("node:assert/strict");
test("headless documents retain views and remove references when a page is deleted", async () => {
  const { validateDocument, applyOperations } = await import("../integrations/design-store.mjs");
  const doc = {
    version: 2,
    name: "Views",
    activePage: "a",
    pages: [
      { id: "a", name: "A", nodes: [] },
      { id: "b", name: "B", nodes: [] },
    ],
    tokens: {},
    views: [{ id: "v", name: "Focus", page: "a", zoom: 1.5, scrollLeft: 40, scrollTop: 80 }],
  };
  assert.equal(validateDocument(doc).views.length, 1);
  assert.equal(applyOperations(doc, [{ type: "delete_page", pageId: "a" }]).views.length, 0);
  assert.throws(() => validateDocument({ ...doc, views: [{ ...doc.views[0], page: "missing" }] }));
  assert.throws(() => validateDocument({ ...doc, views: [{ ...doc.views[0], scrollLeft: -1 }] }));
});

test("two-percent saved views survive preparation and headless validation", async () => {
  const { validateDocument, prepareDocument } = await import("../integrations/document-core.mjs");
  for (const zoom of [0.02, 0.05, 1, 32]) {
    const doc = {
      version: 2,
      name: "Zoom",
      activePage: "a",
      pages: [{ id: "a", name: "A", nodes: [] }],
      tokens: {},
      views: [
        {
          id: "v",
          name: "Overview",
          page: "a",
          zoom,
          scrollLeft: 0,
          scrollTop: 0,
          x: -100000,
          y: 100000,
        },
      ],
    };
    const repairs = [];
    prepareDocument(doc, {}, repairs);
    assert.equal(validateDocument(doc).views[0].zoom, zoom);
    assert.deepEqual(repairs, []);
    assert.throws(() => validateDocument({ ...doc, views: [{ ...doc.views[0], zoom: 0.019 }] }));
  }
});
