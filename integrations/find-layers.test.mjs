import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex, search } from "../web/src/islands/chrome/find-layers/search.ts";
test("finder tree order, cycles, literal snippets and exact short IDs", () => {
  const node = (id, parentId = null, extra = {}) => ({
    id,
    parentId,
    name: id,
    type: "rectangle",
    ...extra,
  });
  const index = buildIndex([
    node("root", null, { shortId: "par" }),
    node("child", "root", { shortId: "kid", text: "A ripe mango [literal]." }),
    node("last"),
    node("cycleA", "cycleB"),
    node("cycleB", "cycleA"),
  ]);
  assert.deepEqual(
    index.map((n) => n.id),
    ["last", "root", "child", "cycleA", "cycleB"],
  );
  assert.equal(search(index, "par.kid")[0].id, "child");
  assert.equal(search(index, "PAR.KID").length, 0);
  assert.equal(search(index, "chil")[0].field, "name");
  assert.equal(search(index, " [literal] ")[0].snippet.hit, "[literal]");
  assert.equal(search(index, "MANGO")[0].snippet.hit, "mango");
  assert.equal(search(index, " ").length, 0);
});
