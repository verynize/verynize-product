import test from "node:test";
import assert from "node:assert/strict";
import { NODE_LIMITS } from "./document-core.mjs";
import { parseJsx } from "./jsx-codec.mjs";

test("JSX imports use the shared document cap and reject excess with a remedy", () => {
  const source = "<div />".repeat(NODE_LIMITS.perDocument);
  assert.equal(parseJsx(source).elements.length, NODE_LIMITS.perDocument);
  assert.throws(
    () => parseJsx(source + "<div />"),
    new RegExp(
      `Import has at least ${NODE_LIMITS.perDocument + 1} elements; limit is ${NODE_LIMITS.perDocument}.*Split the import`,
    ),
  );
});
