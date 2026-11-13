// Every test the suite runs, and which source files each one covers. Read by scripts/run-tests.mjs
// (`npm test`, `npm run test:changed`, CI). Add new test files here: the runner fails when a test
// entry under tests/ is missing from this list.
//
// Entry fields:
//   file       test file, relative to the repo root (also the entry id unless `id` is set)
//   cmd        command line (default: "node --test <file>" for node:test files, else "node <file>")
//   group      canvas | desktop | integrations | ux | cloud | cloud-node | web | e2e-cloud
//              (and the manual groups cloud-vercel | web-nitro | package, run only when named with --group)
//   lane       node | electron (needs a display, xvfb on headless Linux) | cloud (Miniflare/workerd
//              or a Node cloud server) | serial (runs alone)
//   covers     globs of source files the test exercises, on top of the files it imports (the runner
//              traces require/import statements transitively, so imported modules need no glob)
//   platforms  e.g. ["darwin"]: skipped elsewhere with a reason
//   locks      shared resources: entries holding the same lock never run at the same time
//   env        extra environment variables
//   timeoutMs  per-test timeout (default 10 minutes)
//   manual     reason string: never part of --all/--changed, runs only when its group is named
import fs from "node:fs";

const root = new URL("../", import.meta.url);

/** Changes here run every Electron-lane test: the shell every window boots through. */
export const CORE_ELECTRON = [
  "web/app.js",
  "web/canvas-render.js",
  "web/document-core.js",
  "web/component-core.js",
  "web/document-safety.js",
  "web/node-index.js",
  "web/index.html",
  "web/platform.js",
  "web/account-store.js",
  "web/style.css",
  "web/assets/**",
  "desktop/main.cjs",
  "desktop/preload.cjs",
  "desktop/app-protocol.cjs",
  "desktop/process-supervisor.cjs",
  "web/src/ui.tsx",
  "web/src/lib/bridge.ts",
  "web/src/lib/mount.tsx",
  "web/src/lib/platform.ts",
  "web/src/lib/desktop-api.ts",
  "web/src/lib/utils.ts",
  "web/src/styles/**",
  "web/src/components/**",
  "web/src/vite-env.d.ts",
  "scripts/build-ui.cjs",
];

/** Changes here run the whole suite. */
export const FULL_SUITE = [
  ".github/actions/**",
  ".github/workflows/tests.yml",
  "package.json",
  "package-lock.json",
  "vite*.config.ts",
  "tsconfig*.json",
  "scripts/run-tests.mjs",
  "scripts/build-integrations.mjs",
  "scripts/test-build-plan.mjs",
  "scripts/test-manifest.mjs",
];

/** Changes here need no tests. */
export const NO_TESTS = [
  "**/*.md",
  "design/**",
  "docs/**",
  "eval/**",
  ".github/**",
  "**/*.{png,jpg,jpeg,gif,webp,svg,ico,icns,pdf}",
  "LICENSE",
  ".gitignore",
  ".dockerignore",
  "components.json",
  "tests/.durations.json",
  "scripts/check.cjs",
  "integrations/assets-live-smoke.mjs", // manual smoke script against a live bucket
  ".vite-hooks/**",
];

/** Files under tests/ that are modules or runners, not test entries. */
export const NON_ENTRY = [
  "tests/helpers/**",
  "tests/fixtures/**",
  "tests/cloud-harness.mjs",
  "tests/run-cloud-node.mjs",
  "tests/run-cloud-vercel.mjs",
];

/**
 * Modules that only compose others (main.cjs requires every desktop module, ui.tsx imports every
 * island). Import tracing does not walk through them, otherwise every change would select every test.
 */
export const COMPOSITION_ROOTS = ["desktop/main.cjs", "web/src/ui.tsx", "cloud/worker.js"];

// Source areas, named after the tests that exercise them.
const isl = (area) => [`web/src/islands/${area}.tsx`, `web/src/islands/${area}/**`];
const AREA = {
  canvas: [
    "web/canvas-interactions.js",
    "web/canvas-drop-hits.js",
    "web/selection-chrome.js",
    "web/text-caret.js",
    "web/canvas.css",
    "web/node-style.js",
    "web/clipboard-commands.js",
    "web/shaders.js",
    ...isl("sidebar"),
    ...isl("chrome"),
    ...isl("context-menu"),
    "desktop/design-files.cjs",
  ],
  inspector: [
    ...isl("inspector"),
    "web/node-style.js",
    "web/shaders.js",
    "web/selection-chrome.js",
  ],
  chat: [
    ...isl("chat"),
    "web/agent-bridge.js",
    "desktop/agent*.cjs",
    "desktop/agents.cjs",
    "desktop/chat-attachments.cjs",
    "tests/fixtures/fake-codex.cjs",
  ],
  code: [
    ...isl("code"),
    "desktop/terminal.cjs",
    "desktop/dev-server.cjs",
    "desktop/projects.cjs",
    "desktop/repositories.cjs",
    "desktop/repository-moves.cjs",
    "desktop/project-search.cjs",
    "desktop/git-changes.cjs",
  ],
  preview: [
    "web/live-preview.*",
    "web/preview-*",
    "web/src/islands/chrome/**",
    "web/src/islands/code/preview-*",
    "desktop/preview*.cjs",
    "desktop/dev-server.cjs",
    "desktop/mcp-bridge.cjs",
  ],
  capture: [
    "desktop/capture-*.cjs",
    "desktop/render.cjs",
    "desktop/render-limits.cjs",
    "desktop/render-bitmap.cjs",
    "desktop/preview-dom.cjs",
    "desktop/html-import.cjs",
    "integrations/export-*.mjs",
    "integrations/fonts.mjs",
    "integrations/font-faces.mjs",
  ],
  generate: [
    "desktop/generate.cjs",
    "desktop/secure-storage.cjs",
    "integrations/image-provider.mjs",
    "integrations/images.mjs",
  ],
  figma: [
    "web/figma-panel.*",
    "desktop/figma*.cjs",
    "desktop/secure-storage.cjs",
    "integrations/figma-*.mjs",
    "web/clipboard-commands.js",
  ],
  mcp: [
    "desktop/mcp-bridge.cjs",
    "desktop/agent-shell.cjs",
    "integrations/design-tools.mjs",
    "integrations/mcp-*.mjs",
    "integrations/shell-tools.mjs",
    "integrations/design-edit.mjs",
    "integrations/jsx-codec.mjs",
  ],
  shell: [
    "web/wonder-shell.*",
    "web/shell-request.js",
    ...isl("chrome"),
    ...isl("sidebar"),
    ...isl("home"),
    "web/src/islands/router.tsx",
    "web/src/lib/router/**",
    "web/src/lib/query/**",
  ],
  settings: [
    ...isl("settings"),
    "web/settings.*",
    "desktop/app-preferences.cjs",
    "desktop/agent-settings.cjs",
    "desktop/agent-profiles.cjs",
    "desktop/agent-auth.cjs",
    "desktop/agent-usage.cjs",
    "desktop/agent-memory.cjs",
    "desktop/agent-tool-config.cjs",
    "desktop/agent-behavior.cjs",
    "integrations/preferences.mjs",
  ],
  document: [
    "web/document-lifecycle.js",
    "desktop/design-files.cjs",
    "integrations/design-store.mjs",
  ],
  cloudRenderer: [
    "web/cloud-*.js",
    "web/room-sync.js",
    "web/cloud-panel.css",
    "web/src/lib/cloud-account.ts",
    "web/src/lib/query/**",
    "desktop/cloud-passkey.cjs",
    "desktop/app-publish.cjs",
    "cloud/**",
  ],
  cloud: [
    "cloud/**",
    "web/room-sync.js",
    "scripts/auth-schema.mjs",
    "tests/fixtures/account-directory-v1.js",
    "tests/fixtures/cloud-worker-v1.js",
  ],
  cloudNode: ["cloud/**", "server/node.mjs", "tests/run-cloud-node.mjs", "Dockerfile"],
  cloudVercel: [
    "cloud/**",
    "api/**",
    "server/vercel-local.mjs",
    "scripts/vercel-build.mjs",
    "tests/run-cloud-vercel.mjs",
    "vercel.json",
  ],
  web: [
    "web-start/**",
    "cloudflare.config.ts",
    "web/index.html",
    "web/app.js",
    "web/platform.js",
    "web/document-*.js",
    "web/shell-request.js",
    "web/src/lib/platform.ts",
    "web/src/lib/router/**",
    "cloud/worker.js",
    "cloud/http.js",
    "scripts/build-ui.cjs",
    "scripts/db-migrate.mjs",
  ],
  desktopAll: ["desktop/**", "web/desktop-panel.*"],
};

const electron = (file, group, covers, extra = {}) => ({
  file,
  group,
  lane: "electron",
  covers,
  ...extra,
});
const unit = (file, group, covers = [], extra = {}) => ({
  file,
  group,
  lane: "node",
  covers,
  ...extra,
});
const CLIP = { locks: ["clipboard"] };

const canvas = [
  electron("tests/canvas-tiles.cjs", "canvas", [...AREA.canvas, "web/canvas-tiles.js"]),
  electron("tests/canvas.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-advanced.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-roundtrip.cjs", "canvas", [...AREA.canvas, ...AREA.document]),
  electron("tests/canvas-shaders.cjs", "canvas", [...AREA.canvas, "integrations/shader*.mjs"]),
  electron("tests/inspector-shader-library.cjs", "canvas", [
    ...AREA.inspector,
    "integrations/shader*.mjs",
  ]),
  electron("tests/inspector-border-mask-binding.cjs", "canvas", AREA.inspector),
  electron("tests/canvas-precision.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-resize.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-transform.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-interactions.cjs", "canvas", AREA.canvas, CLIP),
  electron("tests/canvas-incremental-render.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-loose-culling.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-drag-scale.cjs", "canvas", [
    ...AREA.canvas,
    "eval/canvas-perf/bench-verynize.cjs",
  ]),
  electron("tests/canvas-clipboard.cjs", "canvas", AREA.canvas, CLIP),
  electron("tests/components.cjs", "canvas", [
    ...AREA.canvas,
    "web/component-core.js",
    "integrations/component-core.mjs",
  ]),
  electron("tests/components-ui.cjs", "canvas", [
    ...AREA.canvas,
    "web/component-core.js",
    "web/canvas-render.js",
    "web/wonder-shell.js",
    "web/src/lib/components.ts",
    "web/src/components/icons.tsx",
    "web/src/islands/sidebar/**",
    "web/src/islands/inspector/component.tsx",
    "web/src/islands/inspector/properties.tsx",
    "web/src/islands/context-menu/**",
    "web/src/islands/chrome/shortcuts.ts",
  ]),
  electron("tests/canvas-image-drop.cjs", "canvas", [...AREA.canvas, "web/image-drop.js"], CLIP),
  electron(
    "tests/canvas-vectors.cjs",
    "canvas",
    [
      ...AREA.canvas,
      ...AREA.inspector,
      "web/vector-*",
      "web/canvas-render.js",
      "web/image-drop.js",
      "web/document-core.js",
      "web/index.html",
      "integrations/vector-*.mjs",
    ],
    CLIP,
  ),
  electron("tests/canvas-context-menu.cjs", "canvas", AREA.canvas, CLIP),
  electron("tests/file-thumbnail.cjs", "canvas", [
    ...isl("home"),
    "web/file-thumbnails.js",
    "desktop/design-files.cjs",
    "desktop/render.cjs",
  ]),
  electron("tests/use-as-mask.cjs", "canvas", [...AREA.canvas, ...AREA.inspector]),
  electron("tests/canvas-spacing.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-constraints.cjs", "canvas", [...AREA.canvas, ...AREA.inspector]),
  electron("tests/inspector-position.cjs", "canvas", AREA.inspector),
  electron("tests/canvas-compositing.cjs", "canvas", AREA.canvas),
  electron("tests/render-readiness.cjs", "canvas", [
    ...AREA.capture,
    "desktop/render.cjs",
    "desktop/assets.cjs",
    "desktop/render-assets.cjs",
    "scripts/render-test-main.cjs",
    "web/asset-store.js",
    "integrations/asset-store.mjs",
    "integrations/asset-urls.cjs",
  ]),
  electron("tests/render-export.cjs", "canvas", [...AREA.capture, "desktop/render.cjs"]),
  electron("tests/canvas-codec.cjs", "canvas", [
    ...AREA.canvas,
    "integrations/jsx-codec.mjs",
    "integrations/codec-*.mjs",
    "integrations/tailwind-*.mjs",
  ]),
  electron("tests/html-import-dialog.cjs", "canvas", [
    "web/src/islands/settings/preview-import.tsx",
    "desktop/html-import.cjs",
    "integrations/codec-*.mjs",
  ]),
  electron("tests/canvas-layers-dnd.cjs", "canvas", AREA.canvas, CLIP),
  electron("tests/canvas-find-layers.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-find-background.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-help-shortcuts.cjs", "canvas", AREA.canvas, CLIP),
  electron("tests/canvas-wonder-marks.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-selection-marks.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-frame-labels.cjs", "canvas", AREA.canvas),
  unit("tests/node-index.cjs", "canvas", ["web/node-index.js"]),
  unit("tests/remote-apply.cjs", "canvas", ["web/remote-apply.js", "web/cloud-ops.js"]),
  electron("tests/canvas-text-caret.cjs", "canvas", AREA.canvas),
  electron("tests/canvas-world-bounds.cjs", "canvas", [...AREA.canvas, "web/document-safety.js"]),
  electron("tests/canvas-page.cjs", "canvas", AREA.canvas),
  electron("tests/inspector-parity.cjs", "canvas", AREA.inspector, CLIP),
  electron(
    "tests/inspector-variable-library.cjs",
    "canvas",
    [...AREA.inspector, "integrations/variables*.mjs"],
    CLIP,
  ),
  electron("tests/inspector-variable-binding.cjs", "canvas", [
    ...AREA.inspector,
    "integrations/variables*.mjs",
  ]),
  electron("tests/inspector-bound-fields.cjs", "canvas", AREA.inspector),
  electron("tests/inspector-type-bind.cjs", "canvas", AREA.inspector),
  electron("tests/inspector-variable-folders.cjs", "canvas", [
    ...AREA.inspector,
    "integrations/variables*.mjs",
  ]),
  electron("tests/canvas-bound-resize.cjs", "canvas", [...AREA.canvas, ...AREA.inspector]),
  electron("tests/inspector-effects.cjs", "canvas", AREA.inspector),
  electron("tests/inspector-paints.cjs", "canvas", [
    ...AREA.inspector,
    ...AREA.capture,
    "integrations/paints.mjs",
  ]),
  electron("tests/inspector-selection-colors.cjs", "canvas", AREA.inspector),
  electron("tests/inspector-typography.cjs", "canvas", [
    ...AREA.inspector,
    "integrations/fonts.mjs",
  ]),
];

const desktop = [
  unit("tests/desktop-release.mjs", "desktop", [
    "scripts/desktop-release.mjs",
    ".github/workflows/desktop-alpha.yml",
  ]),
  unit("tests/identity-check.mjs", "integrations", [
    "scripts/check-identity.mjs",
    ".identity-allow",
  ]),
  unit("tests/window-cleanup.cjs", "desktop"),
  unit("tests/ipc-contract.cjs", "desktop", ["desktop/*.cjs", "desktop/ipc-contract.ts"]),
  unit(
    "tests/platform-contract.cjs",
    "desktop",
    ["web/platform.js", "web/src/lib/platform.ts", "desktop/preload.cjs", "desktop/README.md"],
    { lane: "electron" },
  ),
  unit("tests/desktop-projects.cjs", "desktop"),
  unit("tests/git-changes.cjs", "desktop"),
  unit("tests/render-bitmap.cjs", "desktop", ["desktop/render-bitmap.cjs"]),
  unit("tests/render-limits.cjs", "desktop", ["desktop/render-limits.cjs"]),
  unit("tests/repositories.cjs", "desktop"),
  electron("tests/code-workspace.cjs", "desktop", [...AREA.code, ...AREA.preview], {
    locks: ["port:5173"],
  }),
  electron("tests/code-terminal.cjs", "desktop", [...AREA.code, "desktop/window-cleanup.cjs"]),
  electron("tests/electron-orphan.cjs", "desktop", ["desktop/main.cjs", "scripts/run-tests.mjs"]),
  electron(
    "tests/runner-orphan.mjs",
    "runner-orphan",
    ["desktop/main.cjs", "scripts/run-tests.mjs"],
    { manual: "intentional runner timeout; run with --group runner-orphan" },
  ),
  electron("tests/changes-panel.cjs", "desktop", [...AREA.code, ...AREA.chat]),
  electron("tests/desktop-ipc.cjs", "desktop", AREA.desktopAll),
  // Crash reports: the shared scrubber, and the desktop opt-in end to end against a local ingest server.
  unit("tests/telemetry-scrub.cjs", "desktop", [
    "web/telemetry-scrub.js",
    "web/src/lib/telemetry/**",
    "cloud/telemetry.js",
    "server/telemetry.mjs",
    "web-start/src/server-telemetry.ts",
    "web-start/src/telemetry.ts",
  ]),
  unit("tests/telemetry-process-loss.cjs", "desktop", ["desktop/telemetry.cjs"]),
  unit("tests/telemetry-release-build.mjs", "desktop", [
    "web-start/build/telemetry.mjs",
    "scripts/env.mjs",
    "vite.renderer.config.ts",
  ]),
  electron("tests/telemetry-desktop.cjs", "desktop", [
    "desktop/telemetry.cjs",
    "web/telemetry-scrub.js",
    "web/src/telemetry.ts",
    "web/src/lib/telemetry/**",
    "web/src/islands/settings/telemetry.tsx",
    "web/src/islands/settings/pages.tsx",
    "web/src/islands/onboarding/telemetry-prompt.tsx",
    "web/src/islands/onboarding.tsx",
    "scripts/package-macos.cjs",
  ]),
  electron("tests/app-protocol.cjs", "desktop", [
    "desktop/storage-migration.cjs",
    "web/storage-migration.html",
  ]),
  electron("tests/storage-migration.cjs", "desktop", ["web/storage-migration.html"]),
  electron("tests/shell-router-file.cjs", "desktop", AREA.shell),
  electron("tests/desktop-integration.cjs", "desktop", AREA.desktopAll),
  unit("tests/figma-import.cjs", "desktop"),
  unit("tests/figma-binary.cjs", "desktop"),
  unit("tests/figma-oauth.cjs", "desktop"),
  electron("tests/figma-paste.cjs", "desktop", AREA.figma, CLIP),
  electron("tests/generation.cjs", "desktop", AREA.generate),
  electron("tests/generation-image.cjs", "desktop", AREA.generate),
  electron(
    "tests/keychain-startup.cjs",
    "desktop",
    [
      "desktop/secure-storage.cjs",
      "desktop/generate.cjs",
      "desktop/figma-oauth.cjs",
      "desktop/main.cjs",
      "web/src/islands/settings/**",
    ],
    { platforms: ["darwin"] },
  ),
  electron("tests/generation-trace.cjs", "desktop", [...AREA.generate, "web/trace-bitmap.js"]),
  ...[
    "agent-options",
    "agent-auth",
    "chatgpt-auth",
    "agent-behavior",
    "agent-runtime",
    "agent-runtime-live",
    "agent-usage-memory",
    "agent-tools",
    "agent-commands",
    "agent-live-status",
    "agent-accounts-tools",
    "codex-sign-in",
    "workspace-search-moves",
    "template-packs",
  ].map((name) => unit(`tests/${name}.cjs`, "desktop")),
  electron("tests/agent-chat.cjs", "desktop", AREA.chat),
  electron("tests/codex-sign-in-ui.cjs", "desktop", AREA.chat),
  electron("tests/codex-settings.cjs", "desktop", [
    ...AREA.chat,
    ...isl("settings"),
    "web/settings.js",
  ]),
  electron("tests/agent-workspace-ui.cjs", "desktop", [...AREA.chat, ...AREA.code]),
  electron("tests/chat-composer-menu.cjs", "desktop", AREA.chat),
  electron("tests/chat-indicators.cjs", "desktop", AREA.chat),
  electron("tests/chat-lazy-transcript.mjs", "e2e-cloud", [...AREA.chat, "web/account-store.js"]),
  electron("tests/chat-markdown.cjs", "desktop", AREA.chat),
  electron("tests/capture-fidelity.cjs", "desktop", AREA.capture),
  electron("tests/capture-live-state.cjs", "desktop", AREA.capture),
  unit("tests/capture-core.cjs", "desktop"),
  electron("tests/capture-remote.cjs", "desktop", AREA.capture),
  electron("tests/capture-export-fonts.cjs", "desktop", AREA.capture),
  electron("tests/preview-setup-lifecycle.cjs", "desktop", [...AREA.preview, ...AREA.chat]),
  electron("tests/preview-toolbar.cjs", "desktop", AREA.preview),
  electron("tests/preview-tab.cjs", "desktop", AREA.preview),
  electron("tests/preview-interaction.cjs", "desktop", AREA.preview),
  electron("tests/window-layout.cjs", "desktop", [...AREA.shell, "desktop/window-cleanup.cjs"]),
  electron("tests/mcp-live.cjs", "desktop", AREA.mcp),
  electron("tests/version-history.cjs", "desktop", [
    ...AREA.mcp,
    ...isl("history"),
    "web/version-history.js",
    "web/version-history-core.js",
    "web/agent-bridge.js",
    "desktop/design-files.cjs",
    "integrations/version-*.mjs",
  ]),
  unit("tests/dev-server.cjs", "desktop"),
  electron(
    "tests/mcp-shell.cjs",
    "desktop",
    [...AREA.mcp, "desktop/terminal.cjs", "desktop/dev-server.cjs"],
    CLIP,
  ),
  electron(
    "tests/preview-frame-inspector.cjs",
    "desktop",
    [...AREA.preview, ...AREA.inspector],
    CLIP,
  ),
  electron("tests/preview-header.cjs", "desktop", AREA.preview, {
    locks: ["port:5199", "port:5173"],
  }),
  electron("tests/preview-frame-chrome.cjs", "desktop", AREA.preview),
  electron("tests/preview-edit.cjs", "desktop", [...AREA.preview, "web/preview-edit.*"]),
];

// node:test files under integrations/, one entry each (the old script ran the glob in one process).
const integrationFiles = fs
  .readdirSync(new URL("integrations/", root))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();
const integrations = integrationFiles.map((name) => {
  const file = `integrations/${name}`;
  const base = name.replace(/\.test\.mjs$/, "");
  const covers = [`integrations/${base}.mjs`, `integrations/${base}/**`];
  if (base === "typed-state") covers.push("integrations/src/**", "scripts/run-tests.mjs");
  if (base === "typecheck-ratchet")
    covers.push("scripts/typecheck-ratchet.mjs", "typecheck-baseline.json", "tsconfig*.json");
  if (base === "storage-limits")
    covers.push("web/room-limits.js", "web/storage-limits.js", "cloud/limits.js");
  if (base === "shader-runtime")
    return electron(
      file,
      "integrations",
      [...covers, "web/shaders.js", "integrations/shader*.mjs"],
      { cmd: `node --test ${file}` },
    );
  // Waits 2s for an fs.watch event, which misses under parallel load: run it alone.
  if (base === "design-files")
    return unit(file, "integrations", covers, { cmd: `node --test ${file}`, lane: "serial" });
  if (base === "design-knowledge" || base === "design-skills")
    covers.push("integrations/design-knowledge/**");
  return unit(file, "integrations", covers, { cmd: `node --test ${file}` });
});

const ux = [
  electron("tests/home-first-opening.cjs", "ux", [
    ...AREA.shell,
    ...AREA.cloudRenderer,
    "tests/helpers/home-first-opening.cjs",
  ]),
  electron("tests/switch-cache.cjs", "ux", [
    ...AREA.shell,
    "web/switch-*.js",
    "web/app.js",
    "web/document-safety.js",
    "web/document-lifecycle.js",
  ]),
  electron("tests/switch-loading-visuals.cjs", "ux", [
    ...AREA.shell,
    "web/page-loader.css",
    "web/switch-coordinator.js",
  ]),
  electron("tests/wonder-shell.cjs", "ux", AREA.shell),
  electron("tests/file-tabs.cjs", "ux", [...AREA.shell, "web/cloud-share.js"]),
  electron("tests/settings.cjs", "ux", AREA.settings),
  electron("tests/settings-image-generation.cjs", "ux", [...AREA.settings, ...AREA.generate]),
  electron("tests/views-templates.cjs", "ux", [
    "web/views-templates.*",
    "desktop/template-packs.cjs",
    ...isl("home"),
  ]),
  unit("tests/views-store.cjs", "ux"),
  electron("tests/document-lifecycle.cjs", "ux", [...AREA.document, ...AREA.cloudRenderer]),
  electron("tests/document-validation-safety.cjs", "ux", AREA.document),
  electron("tests/library-implicit-files.cjs", "ux", [
    ...AREA.document,
    ...AREA.shell,
    "web/cloud-panel.js",
  ]),
  electron("tests/library-unload-persistence.cjs", "ux", [
    ...AREA.document,
    ...AREA.shell,
    "web/library-storage.js",
  ]),
  electron("tests/cloud-async.cjs", "ux", AREA.cloudRenderer),
  electron("tests/shell-router.cjs", "ux", [...AREA.shell, ...AREA.cloudRenderer]),
  electron("tests/settings-route.cjs", "ux", [...AREA.settings, ...AREA.shell]),
  electron("tests/shell-routes.cjs", "ux", AREA.shell),
  electron("tests/canvas-css-invalidation.cjs", "canvas", [
    "web/src/**",
    "web/*.css",
    "web/selection-chrome.js",
    "scripts/check-css-has.cjs",
    "eval/canvas-perf/renderer.cjs",
  ]),
  electron("tests/ui-ready.cjs", "ux", AREA.shell),
  electron("tests/panel-resize.cjs", "ux", AREA.shell),
  electron("tests/sidebar-scroll.cjs", "ux", [...AREA.shell, ...AREA.inspector, ...isl("chat")]),
  electron("tests/web-platform.cjs", "ux", [
    ...AREA.shell,
    "web/file-thumbnails.js",
    "web/platform.js",
    "web/src/lib/platform.ts",
  ]),
  electron("tests/storage-limits-ux.mjs", "ux", [
    ...AREA.cloudRenderer,
    ...AREA.document,
    ...isl("storage"),
    "web/storage-limits.js",
    "web/room-limits.js",
  ]),
  electron(
    "tests/share-popover.cjs",
    "ux",
    [...AREA.cloudRenderer, ...isl("share"), ...isl("chrome")],
    CLIP,
  ),
];

/** The cloud scenarios; run on workerd (group cloud), on Node (cloud-node) and on Vercel (cloud-vercel). */
export const CLOUD_SCENARIOS = [
  "tests/cloud-rooms.mjs",
  "tests/cloud-room-pages.mjs",
  "tests/cloud-version-history.mjs",
  "tests/cloud-auth.mjs",
  "tests/cloud-web-access.mjs",
  "tests/cloud-auth-bridge.mjs",
  "tests/cloud-orgs.mjs",
  "tests/cloud-account-state.mjs",
  "tests/cloud-account-feed.mjs",
  "tests/cloud-share.mjs",
  "tests/cloud-directory-migration.mjs",
  "tests/cloud-merge.mjs",
  "tests/cloud-vectors.mjs",
  "tests/cloud-accounts.mjs",
  "tests/cloud-accounts-sessions.mjs",
  "tests/cloud-passkeys.mjs",
  "tests/cloud-apps.mjs",
  "tests/cloud-email.mjs",
  "tests/cloud-mcp.mjs",
  "tests/cloud-ai.mjs",
  "tests/cloud-ai-providers.mjs",
  "tests/cloud-ai-cancel.mjs",
  "tests/cloud-ai-durable.mjs",
  "tests/cloud-assets.mjs",
  "tests/cloud-thumbnails.mjs",
  "tests/cloud-pages-assets.mjs",
  "tests/cloud-page-icons.mjs",
];
const cloud = [
  ...CLOUD_SCENARIOS,
  "tests/cloud-room-poison.mjs",
  // Fault-injecting room subclass (workerd modules): workerd only.
  "tests/cloud-sync-integrity.mjs",
  "tests/cloud-ops-indexed.mjs",
  "tests/cloud-room-scale.mjs",
].map((file) => ({
  file,
  group: "cloud",
  lane: "cloud",
  covers: AREA.cloud,
}));
cloud.push(unit("tests/room-sync.mjs", "cloud", ["web/room-sync.js"]));
const cloudNode = [...CLOUD_SCENARIOS, "tests/cloud-node-server.mjs"].map((file) => ({
  id: `node:${file}`,
  file,
  group: "cloud-node",
  lane: "cloud",
  covers: AREA.cloudNode,
  env: { CLOUD_RUNTIME: "node" },
}));
const cloudVercel = [...CLOUD_SCENARIOS, "tests/cloud-vercel-instances.mjs"].map((file) => ({
  id: `vercel:${file}`,
  file,
  group: "cloud-vercel",
  lane: "cloud",
  covers: AREA.cloudVercel,
  env: { CLOUD_RUNTIME: "vercel" },
  manual: "needs redis-server; run with --group cloud-vercel (npm run test:cloud:vercel)",
}));

// Each builds the web app (vp build writes .cloudflare/output, dist/ and web-start/src/routeTree.gen.ts;
// web-ai-chat also rebuilds web/dist), so they hold one lock.
const webBuild = (file, covers, extra = {}) => ({
  file,
  group: "web",
  lane: "node",
  covers: [...AREA.web, ...covers],
  locks: ["vp-build"],
  timeoutMs: 15 * 60_000,
  ...extra,
});
const AI = [
  "cloud/ai*.js",
  "cloud/ai-providers/**",
  "web-start/**",
  "server/node.mjs",
  "tests/helpers/fake-openrouter.mjs",
  "tests/helpers/fake-chat-completions.mjs",
];
const web = [
  webBuild("tests/web-legacy-assets.mjs", []),
  webBuild("tests/web-cloudflare.mjs", ["tests/helpers/web-home-boot.mjs"]),
  webBuild("tests/web-icons.mjs", []),
  webBuild("tests/web-node.mjs", []),
  webBuild("tests/env-build.mjs", [
    "scripts/env.mjs",
    "web-start/build/telemetry.mjs",
    ".env.example",
  ]),
  webBuild("tests/web-telemetry.mjs", [
    "vite.node.config.ts",
    "web/telemetry-scrub.js",
    "web/src/lib/telemetry/**",
  ]),
  webBuild("tests/ai-routing.mjs", [...AI, "api/**", "vercel.json", "cloud/platform/**"]),
  webBuild("tests/web-ai-chat.mjs", [
    ...AI,
    "web/src/lib/agent-service.ts",
    "web/src/lib/agent-transport.ts",
    "web/src/lib/ai-*.ts",
    ...isl("chat"),
    ...isl("settings"),
  ]),
  webBuild("tests/web-nitro.mjs", ["vite.nitro.config.ts", "web-start/nitro/**"], {
    group: "web-nitro",
    manual: "opt-in Nitro build; run with --group web-nitro (npm run test:web:nitro)",
  }),
];

const e2eCloud = [
  electron("tests/account-store-network.mjs", "e2e-cloud", ["web/account-store.js"]),
  electron("tests/cloud-switch-cache.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "web/switch-*.js",
    "web/app.js",
    "web/wonder-shell.js",
  ]),
  electron("tests/cloud-desktop.mjs", "e2e-cloud", AREA.cloudRenderer),
  electron("tests/cloud-undo-after-leave.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "web/remote-apply.js",
    "web/commit-state.js",
  ]),
  electron("tests/cloud-gesture-remote.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "web/remote-apply.js",
    "web/canvas-interactions.js",
    "web/selection-chrome.js",
    "web/text-caret.js",
  ]),
  electron("tests/cloud-pages-desktop.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "web/page-loader.js",
  ]),
  electron("tests/cloud-sync-integrity-desktop.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "web/page-loader.js",
    "web/storage-limits.js",
  ]),
  electron("tests/cloud-database-sync.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "web/account-store.js",
    "web/settings.js",
    "web/desktop-panel.js",
    ...isl("home"),
  ]),
  electron("tests/cloud-files-desktop.mjs", "e2e-cloud", [...AREA.cloudRenderer, ...isl("home")]),
  electron("tests/cloud-version-history-desktop.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    ...isl("history"),
    "web/version-history.js",
    "web/version-history-core.js",
  ]),
  electron(
    "tests/share-collab.mjs",
    "e2e-cloud",
    [...AREA.cloudRenderer, ...isl("share"), ...isl("collab")],
    CLIP,
  ),
  electron("tests/cloud-assets-desktop.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "integrations/assets.mjs",
  ]),
  electron("tests/cloud-thumbnail-desktop.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    ...isl("home"),
    "web/file-thumbnails.js",
    "cloud/assets.js",
    "cloud/schema.js",
    "cloud/migrations/*",
  ]),
  electron("tests/cloud-accounts-desktop.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    ...isl("settings"),
  ]),
  electron("tests/cloud-passkeys-desktop.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    ...isl("settings"),
  ]),
  electron("tests/cloud-account-pages.mjs", "e2e-cloud", AREA.cloudRenderer),
  electron("tests/desktop-onboarding.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    ...isl("onboarding"),
  ]),
  electron("tests/desktop-workspaces.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    ...isl("home"),
    "desktop/repositories.cjs",
  ]),
  electron("tests/cloud-query-cache.mjs", "e2e-cloud", [
    ...AREA.cloudRenderer,
    "web/src/lib/query/**",
  ]),
];

const manual = [
  electron("tests/package-smoke.cjs", "package", ["scripts/package-macos.cjs"], {
    platforms: ["darwin"],
    manual: "needs dist/Verynize.app (npm run package:mac); run with --group package",
  }),
];

export const tests = [
  unit("tests/ai-provider-gateways.mjs", "cloud", [
    "cloud/ai-providers/cloudflare.js",
    "cloud/ai-providers/sumopod.js",
    "tests/helpers/fake-gateway-upstream.mjs",
  ]),
  {
    file: "tests/renderer-commit-performance.cjs",
    group: "canvas",
    lane: "electron",
    covers: [
      "web/app.js",
      "web/canvas-render.js",
      "web/wonder-shell.js",
      "web/commit-validation.js",
      "web/commit-state.js",
      "web/library-storage.js",
      "web/selection-chrome.js",
      "web/selection-bounds.js",
      "web/lazy-document.js",
      "web/src/islands/sidebar/**",
      "web/src/islands/inspector/**",
    ],
  },
  {
    file: "tests/commit-state.cjs",
    group: "canvas",
    lane: "node",
    covers: [
      "web/commit-state.js",
      "web/commit-validation.js",
      "web/lazy-document.js",
      "web/remote-apply.js",
    ],
  },
  ...canvas,
  ...desktop,
  ...integrations,
  ...ux,
  ...cloud,
  ...cloudNode,
  ...web,
  ...e2eCloud,
  ...cloudVercel,
  ...manual,
];
export default tests;
