// Runtime platform: ONE place that answers "what can this runtime do". Loaded first by web/index.html (a classic
// script, before every legacy script and the React bundle) and imported by web/src/lib/platform.ts, which types it
// and re-exports it to the islands. Registers window.verynizePlatform:
//
//   kind          'desktop' (the Electron preload exposed window.desktop, desktop/preload.cjs) | 'web'
//   desktop       window.desktop, or null in the plain web build
//   capabilities  {name: boolean}; a capability is true when every desktop method it needs is present
//   can(name)     capabilities[name] === true (unknown names are false)
//   agents        the chat AgentService registry ({provide, service, ready, changed, subscribe}), see below
//
// Check capabilities, not window.desktop, before showing or running a desktop feature; then call
// platform.desktop.x() (legacy code may keep calling window.desktop.x() behind a capability check).
// The method lists below are checked against desktop/preload.cjs by tests/platform-contract.cjs.
(function (root) {
  "use strict";
  if (root.verynizePlatform) return;
  const CAPABILITY_METHODS = {
    // Local project folder: open, list, read and write files (desktop/projects.cjs).
    projects: ["openProject", "createProject", "listFiles", "readFile", "writeFile"],
    // Repositories, chat worktrees, git status/changes/commit/push (desktop/repositories.cjs, git-changes.cjs).
    git: ["repositories.list", "gitStatus", "gitChanges", "gitDiff", "gitCommit"],
    // Native *.verynize.json files next to the code (desktop/design-files.cjs).
    designFiles: ["designOpen", "designSave", "designDetach", "onDesignFileChanged"],
    // Version history sidecar of the open native file (desktop/design-files.cjs, docs/version-history.md).
    versionHistory: ["versionsList", "versionsGet", "versionsAdd"],
    // Local Claude/Codex agents (desktop/agent-runtime.cjs) and their sign-in.
    agents: ["discoverAgents", "runAgent", "cancelAgent", "onAgentEvent"],
    agentAccounts: ["agentAccountStatus", "startAgentLogin", "agentLogout"],
    // Integrated terminal (desktop/terminal.cjs).
    terminal: ["terminalCreate", "terminalWrite", "onTerminalData"],
    // Project dev server and running-app preview frames (desktop/dev-server.cjs, desktop/preview.cjs).
    devServer: ["devServer.status", "devServer.start", "devServer.stop"],
    livePreview: ["previewNavigate", "previewElementAt", "captureLivePreview", "previewDom"],
    // Offscreen PNG/PDF rendering and native save (desktop/render.cjs).
    rasterExport: ["renderDesign", "renderPDF", "saveExport"],
    codeExport: ["exportCode"],
    imageGeneration: ["imageProvider.generate"],
    // Figma import: link (REST or connected account), clipboard paste and .fig files (desktop/figma*.cjs).
    figma: ["importFigma", "figmaClipboard", "figmaFile", "figmaFileOpen", "figmaOAuth.status"],
    // Native HTML import (integrations codec) and template packs as zip files (desktop/template-packs.cjs).
    htmlImport: ["importHtml", "importHtmlFile"],
    templatePacks: ["templatePacks.encode", "templatePacks.decode"],
    // Web page capture into editable layers (desktop/capture-remote.cjs).
    webCapture: ["captureRemote", "captureRemoteProbe"],
    // Share › Publish app: build the open project and upload it (desktop/app-publish.cjs).
    publishApps: ["cloudAppDetect", "cloudAppPublish"],
    passkeyWindow: ["cloudPasskeyOpen", "cloudPasskeyClose"],
    // Installed system fonts (desktop/fonts.cjs).
    localFonts: ["fontCatalog", "fontFaces"],
    notifications: ["notifyTask"],
    externalLinks: ["openExternal"],
    // Agent MCP bridge into the editor (desktop/mcp-bridge.cjs, web/agent-bridge.js).
    agentBridge: ["agentBridge.onCall", "agentBridge.reply"],
    onboarding: ["onboardingState"],
    // Share panel server default (desktop/cloud-defaults.cjs).
    cloudDefaults: ["cloudDefaults"],
    // Crash report opt-in (desktop/telemetry.cjs).
    telemetry: ["telemetry.get", "telemetry.set"],
  };
  const exposed = root.desktop;
  const desktop = exposed && typeof exposed === "object" ? exposed : null;
  const method = (path) =>
    path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), desktop);
  const capabilities = {};
  for (const [name, paths] of Object.entries(CAPABILITY_METHODS))
    capabilities[name] = !!desktop && paths.every((path) => typeof method(path) === "function");
  Object.freeze(capabilities);
  // Chat agent transport (web/src/lib/agent-service.ts): the one AgentService chat code runs turns through. It is not a
  // desktop capability: the React bundle provides it, over IPC on the desktop (when `agents` is true) and over the
  // cloud backend's model API (/api/ai/*) on the web. `ready()` is the service's own "can run a turn now" answer
  // (web: signed in on this server and GET /api/ai/config enabled); `subscribe` fires when the service or that
  // answer changes.
  let agentService = null;
  const agentListeners = new Set();
  const agentsChanged = () => {
    for (const listener of agentListeners)
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
  };
  const agents = Object.freeze({
    provide(service) {
      agentService = service || null;
      agentsChanged();
      return () => {
        if (agentService !== service) return;
        agentService = null;
        agentsChanged();
      };
    },
    service: () => agentService,
    ready: () => !!agentService && agentService.ready() === true,
    changed: agentsChanged,
    subscribe(listener) {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
  });
  const platform = Object.freeze({
    kind: desktop ? "desktop" : "web",
    desktop,
    capabilities,
    can: (name) => Object.hasOwn(capabilities, name) && capabilities[name] === true,
    CAPABILITY_METHODS: Object.freeze(CAPABILITY_METHODS),
    agents,
  });
  // html[data-platform=desktop|web]: CSS that differs per runtime (the macOS traffic-light inset, globals.css).
  if (root.document && root.document.documentElement)
    root.document.documentElement.dataset.platform = platform.kind;
  Object.defineProperty(root, "verynizePlatform", {
    value: platform,
    enumerable: false,
    configurable: false,
    writable: false,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
