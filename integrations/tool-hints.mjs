import { NODE_LIMITS, pageWorldBounds } from "./document-core.mjs";
import { getPage, indexPage } from "./design-edit.mjs";
import { isReceiptValid } from "./verification.mjs";

export function toolHints({ page, artboards = [], revision, receiptFor, omit = new Set() }) {
  const lines = [];
  // Hints also accept metadata-only page summaries. Geometry is available on full tool reads.
  if (
    page.nodes.every((n) => n.id && ["x", "y", "w", "h"].every((k) => Number.isFinite(n[k]))) &&
    pageWorldBounds(page).advisory
  )
    lines.push(
      "Content extends beyond ±100,000 world px. Use Recenter page in the editor to move it closer to the origin.",
    );
  if (!omit.has("assets")) {
    const count = page.nodes.filter(
      (n) => n.assetStatus === "pending" || n.assetStatus === "missing",
    ).length;
    if (count)
      lines.push(
        `${count} image(s) still pending/missing on page ${page.id}; resolve before finishing.`,
      );
  }
  if (page.nodes.length >= NODE_LIMITS.perPage * 0.9)
    lines.push(
      `Page ${page.id} is at ${page.nodes.length.toLocaleString("en-US")}/${NODE_LIMITS.perPage.toLocaleString("en-US")} nodes; use another page for large additions.`,
    );
  for (const id of artboards) {
    const receipt = receiptFor(id);
    if (
      !omit.has("lint") &&
      receipt?.documentRevision === revision &&
      receipt.lint?.counts.critical
    )
      lines.push(
        `${receipt.lint.counts.critical} critical lint issues remain on ${id}; fix before finishing.`,
      );
    if (!omit.has("screenshot") && !isReceiptValid(receipt, revision))
      lines.push(
        `Call take_screenshot on ${id} before finish_artboard; no current verified screenshot.`,
      );
  }
  return lines.slice(0, 2).join("\n");
}

// Wrap the shared definitions, so hosted, desktop and stdio consumers all get the hints.
export function attachToolHints(table, { read, session, keyOf }) {
  for (const [name, tool] of Object.entries(table)) {
    if (
      !("pageId" in tool.inputSchema) &&
      !("document" in tool.inputSchema) &&
      !["read_document", "apply_operations"].includes(name)
    )
      continue;
    if (name === "finish_artboard") continue;
    const run = tool.run;
    const readOnly = !!tool.annotations?.readOnlyHint;
    tool.run = async (args) => {
      session.last = null;
      const result = await run(args);
      if (result?.isError) return result;
      try {
        const ref = ["read_document", "apply_operations"].includes(name)
          ? args.name
          : args.document;
        // Reuse the document the tool just read or wrote instead of reading it again.
        const state = session.last?.ref === ref ? session.last.state : await read(ref);
        const page = getPage(state.document, args.pageId || result?.pageId);
        const index = indexPage(page);
        const roots =
          args.id || args.ids?.length
            ? [
                ...new Set(
                  [...(args.ids || []), ...(args.id ? [args.id] : [])]
                    .map((id) => {
                      let node = index.resolve(id);
                      while (node?.parentId) node = index.byId.get(node.parentId);
                      return node?.shortId;
                    })
                    .filter(Boolean),
                ),
              ]
            : index.children(null).map((n) => n.shortId);
        const hint = toolHints({
          page,
          artboards: roots,
          revision: state.revision,
          receiptFor: (id) => session.receipts.latest(keyOf(state.name, ref), id),
          omit:
            name === "take_screenshot"
              ? new Set(["assets", "lint", "screenshot"])
              : readOnly
                ? new Set(["lint", "screenshot"])
                : new Set(
                    result?.pendingImages ||
                      (typeof result === "string" && /remote image.*downloading/.test(result))
                      ? ["assets"]
                      : [],
                  ),
        });
        if (!hint) return result;
        if (result?.content)
          return {
            ...result,
            content: [...result.content, { type: "text", text: `Next: ${hint}` }],
          };
        if (typeof result === "string") return `${result}\n\nNext: ${hint}`;
        return { ...result, nextStep: hint };
      } catch {
        return result;
      } // A post-result read failure must not turn a committed edit into an error.
    };
  }
}
