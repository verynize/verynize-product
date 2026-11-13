import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { exportHTML } from "./export-html.mjs";
test("CLI creates, applies, reads and exports the same persisted documents", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = (args, input) =>
    spawnSync(process.execPath, ["integrations/design-cli.mjs", "--root", root, ...args], {
      encoding: "utf8",
      input,
    });
  const created = run(["create", "landing", "Landing"]);
  assert.equal(created.status, 0, created.stderr);
  const state = JSON.parse(created.stdout),
    pageId = state.document.pages[0].id;
  const edited = run(
    ["apply", "landing", state.revision],
    JSON.stringify([
      {
        type: "create_node",
        pageId,
        node: {
          id: "title",
          name: "Title",
          type: "text",
          text: "Hello <script>alert(1)</script>",
          fontWeight: 700,
        },
      },
    ]),
  );
  assert.equal(edited.status, 0, edited.stderr);
  const read = JSON.parse(run(["read", "landing"]).stdout);
  assert.equal(read.document.pages[0].nodes[0].fontWeight, "700");
  const html = run(["export", "landing"]);
  assert.equal(html.status, 0, html.stderr);
  assert.match(html.stdout, /&lt;script&gt;/);
  assert.doesNotMatch(html.stdout, /<script>/);
  assert.deepEqual(JSON.parse(run(["list"]).stdout), ["landing"]);
  assert.equal(run(["apply", "landing", state.revision], "[]").status, 1);
});
test("standalone export preserves nested flex/grid, variables, masks, images and mixed text safely", () => {
  const base = { x: 0, y: 0, w: 200, h: 100, color: "#ffffff" };
  const doc = {
    version: 2,
    name: "<Title>",
    tokens: { brand: "#112233" },
    pages: [
      {
        id: "page",
        name: "Main",
        nodes: [
          {
            ...base,
            id: "frame",
            name: "Frame",
            type: "frame",
            layout: "flex",
            direction: "column",
            gap: 8,
            padding: 12,
            gradient: "linear-gradient(red, blue)",
            mask: "linear-gradient(black, transparent)",
            animated: "aurora",
          },
          {
            ...base,
            id: "grid",
            name: "Grid",
            type: "frame",
            parentId: "frame",
            layout: "grid",
            columns: 3,
          },
          {
            ...base,
            id: "text",
            name: "Text",
            type: "text",
            parentId: "grid",
            text: "Hello & world",
            textRuns: [
              { start: 0, end: 5, bold: true, italic: true, color: "#abcdef", fontSize: 40 },
            ],
            token: "brand",
          },
          {
            ...base,
            id: "image",
            name: '" onerror="alert(1)',
            type: "image",
            parentId: "frame",
            src: "data:image/png;base64,aGVsbG8=",
          },
        ],
      },
    ],
  };
  const html = exportHTML(doc, "page");
  assert.match(html, /display:flex/);
  assert.match(html, /animation:design-gradient/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /color:#abcdef;font-size:40px/);
  assert.match(html, /display:grid/);
  assert.match(html, /repeat\(3,/);
  assert.match(html, /mask-image:linear-gradient/);
  assert.match(html, /color:#112233/);
  assert.match(html, /font-weight:700;font-style:italic/);
  assert.match(html, /Hello<\/span>/);
  assert.match(html, /&amp; world/);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /alt="" onerror=/);
  assert.match(html, /&lt;Title&gt;/);
});
