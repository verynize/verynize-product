// Only these scenarios consume the same Node web bundle. Keep it separate from the
// Cloudflare bundle: their output directories and runtime contracts differ.
const WEB_NODE_TESTS = new Set([
  "tests/web-node.mjs",
  "tests/web-ai-chat.mjs",
  "tests/ai-routing.mjs",
]);

export function testBuildPlan(selected, { skipBuild = false } = {}) {
  const node = selected.some((entry) => WEB_NODE_TESTS.has(entry.file));
  return {
    ui: !skipBuild && selected.some((entry) => entry.lane === "electron" || entry.group === "web"),
    worker: selected.some((entry) => entry.usesWorker),
    node,
  };
}
