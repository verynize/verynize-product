const { contextBridge, ipcRenderer } = require("electron");
/** @type {import("./ipc-contract").Invoke} */
const call = (method, ...args) =>
  ipcRenderer.invoke("desktop:" + method, .../** @type {unknown[]} */ (args));
// Expected non-repository state crosses IPC normally; preserve the renderer's existing error UI.
const changesResult = (result) => {
  if (result?.code === "not-a-repo") throw Error(result.message);
  return result;
};
// Crash report settings for web/src/telemetry.ts, passed by main as an additional argument (desktop/telemetry.cjs).
const telemetryConfig = (() => {
  const arg = (process.argv || []).find(
    (value) => typeof value === "string" && value.startsWith("--verynize-telemetry="),
  );
  try {
    return Object.freeze(JSON.parse(atob(arg.slice("--verynize-telemetry=".length))));
  } catch {
    return Object.freeze({ enabled: false });
  }
})();
contextBridge.exposeInMainWorld("desktop", {
  agentAccountStatus: (options) => call("agentAccountStatus", options),
  startAgentLogin: (options) => call("startAgentLogin", options),
  cancelAgentLogin: (options) => call("cancelAgentLogin", options),
  agentLogout: (options) => call("agentLogout", options),
  openExternal: (url) => call("openExternal", url),
  onboardingState: () => call("onboardingState"),
  cloudDefaults: () => call("cloudDefaults"),
  onAuthEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("desktop:auth-event", listener);
    return () => ipcRenderer.removeListener("desktop:auth-event", listener);
  },
  writeClipboardImage: (dataURL) => call("writeClipboardImage", dataURL),
  notifyTask: (options) => call("notifyTask", options),
  // Share › Publish app (desktop/app-publish.cjs): build the open project and upload it to the cloud server.
  cloudAppDetect: () => call("cloudAppDetect"),
  cloudAppPublish: (options) => call("cloudAppPublish", options),
  cloudPasskeyOpen: (options) => call("cloudPasskeyOpen", options),
  cloudPasskeyClose: () => call("cloudPasskeyClose"),
  // Settings › Preferences hook (desktop/app-preferences.cjs): custom chat sound, verynize:// links, worktree line counts.
  appPreferences: {
    chooseSound: () => call("soundChoose"),
    readSound: () => call("soundRead"),
    clearSound: () => call("soundClear"),
    linksReady: (options) => call("linksReady", options),
    setLinksEnabled: (enabled) => call("linksSetEnabled", enabled),
    worktreeLineStats: (roots) => call("worktreeLineStats", roots),
    onOpenLink: (callback) => {
      const listener = (_event, url) => callback(url);
      ipcRenderer.on("desktop:open-link", listener);
      return () => ipcRenderer.removeListener("desktop:open-link", listener);
    },
  },
  // end Settings › Preferences hook
  // Crash reports (desktop/telemetry.cjs): opt-in setting and the renderer SDK configuration.
  telemetry: {
    config: () => telemetryConfig,
    get: () => call("telemetryGet"),
    set: (enabled) => call("telemetrySet", enabled),
  },
  // Settings › Usage and Memory (desktop/agent-usage.cjs, desktop/agent-memory.cjs).
  agentUsage: {
    read: (options) => call("agentUsage", options),
    layers: () => call("agentLayerUsage"),
  },
  // Named provider accounts, Verynize MCP servers + permission defaults, per-chat autonomy (desktop/agent-profiles.cjs, agent-tool-config.cjs, agent-autonomy.cjs).
  agentProfiles: {
    list: () => call("agentProfilesList"),
    add: (options) => call("agentProfilesAdd", options),
    rename: (options) => call("agentProfilesRename", options),
    remove: (options) => call("agentProfilesRemove", options),
    setDefault: (options) => call("agentProfilesSetDefault", options),
    setChat: (options) => call("agentProfilesSetChat", options),
    chat: (options) => call("agentProfilesChat", options),
  },
  agentToolConfig: {
    list: () => call("agentToolConfigList"),
    saveServer: (options) => call("agentToolConfigSaveServer", options),
    setEnabled: (options) => call("agentToolConfigSetEnabled", options),
    removeServer: (options) => call("agentToolConfigRemoveServer", options),
    setPermission: (options) => call("agentToolConfigSetPermission", options),
  },
  agentAutonomy: {
    get: (options) => call("agentAutonomyGet", options),
    set: (options) => call("agentAutonomySet", options),
  },
  // Global search and history-preserving moves (desktop/project-search.cjs, desktop/repository-moves.cjs).
  templatePacks: {
    encode: (pack) => call("templatePackEncode", pack),
    decode: (bytes) => call("templatePackDecode", bytes),
  },
  projectSearch: {
    search: (options) => call("projectSearch", options),
    open: (options) => call("projectSearchOpen", options),
  },
  repositoryMoves: {
    moveInside: (options) => call("repositoryMoveInside", options),
    relocate: (options) => call("repositoryRelocate", options),
    moveAcross: (options) => call("repositoryMoveAcross", options),
    chooseDestination: () => call("repositoryChooseDestination"),
  },
  // Composer indicators (desktop/agent-live-status.cjs): live MCP server status and context breakdown of a chat's run.
  agentLiveStatus: {
    mcp: (options) => call("agentLiveMcpStatus", options),
    context: (options) => call("agentLiveContext", options),
  },
  agentMemory: {
    overview: () => call("agentMemoryOverview"),
    reveal: (options) => call("agentMemoryReveal", options),
    open: (options) => call("agentMemoryOpen", options),
  },
  // integrated terminal hook (desktop/terminal.cjs): PTY shells for the code-mode terminal panel.
  terminalCreate: (options) => call("terminalCreate", options),
  terminalWrite: (options) => call("terminalWrite", options),
  terminalResize: (options) => call("terminalResize", options),
  terminalKill: (options) => call("terminalKill", options),
  onTerminalData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("desktop:terminal-data", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-data", listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("desktop:terminal-exit", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-exit", listener);
  },
  // end integrated terminal hook
  // agent-runtime parity hook: second-opinion review of the latest answer (desktop/agent-runtime.cjs review()).
  reviewAgent: (options) => call("reviewAgent", options),
  // end agent-runtime parity hook
  // Settings › Agents (desktop/agent-tools.cjs): provider accounts, the agents' own MCP servers, Access switches.
  agentTools: {
    accounts: () => call("agentProviderAccounts"),
    listServers: (options) => call("agentMcpList", options),
    addServer: (options) => call("agentMcpAdd", options),
    removeServer: (options) => call("agentMcpRemove", options),
    loginServer: (options) => call("agentMcpLogin", options),
    getAccess: () => call("agentAccessGet"),
    setAccess: (changes) => call("agentAccessSet", changes),
  },
  // agent-bridge hook: MCP tool requests from main (bd:mcp-call) and replies (bd:mcp-reply) only.
  agentBridge: {
    onCall: (callback) => {
      const listener = (_event, request) => callback(request);
      ipcRenderer.on("bd:mcp-call", listener);
      return () => ipcRenderer.removeListener("bd:mcp-call", listener);
    },
    reply: (requestId, payload) => ipcRenderer.send("bd:mcp-reply", String(requestId), payload),
  },
  // end agent-bridge hook
  renderDesign: (options) => call("renderDesign", options),
  fontFaces: (families) => call("fontFaces", families),
  // inspector export hook (desktop/render.cjs registerArtworkExport): artwork PDF, native save dialog, font catalog.
  renderPDF: (options) => call("renderPDF", options),
  saveExport: (options) => call("saveExport", options),
  fontCatalog: () => call("fontCatalog"),
  exportCode: (options) => call("exportCode", options),
  importHtml: (options) => call("importHtml", options),
  importHtmlFile: (options) => call("importHtmlFile", options),
  // end inspector export hook
  importFigma: (options) => call("importFigma", options),
  // Figma clipboard/.fig import and OAuth account (desktop/figma.cjs, desktop/figma-oauth.cjs).
  figmaClipboard: (html) => call("figmaClipboard", html),
  figmaFile: (options) => call("figmaFile", options),
  figmaFileOpen: () => call("figmaFileOpen"),
  figmaOAuth: {
    status: () => call("figmaOAuthStatus"),
    configure: (options) => call("figmaOAuthConfigure", options),
    connect: () => call("figmaOAuthConnect"),
    cancel: () => call("figmaOAuthCancel"),
    disconnect: () => call("figmaOAuthDisconnect"),
  },

  designDetach: () => call("designDetach"),
  designOpen: () => call("designOpen"),
  designSave: (options) => call("designSave", options),
  designReload: () => call("designReload"),
  onDesignFileChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("design:file-changed", listener);
    return () => ipcRenderer.removeListener("design:file-changed", listener);
  },
  // Version history sidecar of the open native file (desktop/design-files.cjs, docs/version-history.md).
  versionsList: (options) => call("versionsList", options),
  versionsGet: (options) => call("versionsGet", options),
  versionsAdd: (options) => call("versionsAdd", options),
  previewInput: (options) => call("previewInput", options),
  previewOpenBrowser: (options) => call("previewOpenBrowser", options),
  previewLocation: (options) => call("previewLocation", options),
  previewNavigate: (options) => call("previewNavigate", options),
  onPreviewNavigated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("desktop:preview-navigated", listener);
    return () => ipcRenderer.removeListener("desktop:preview-navigated", listener);
  },
  previewInspect: (options) => call("previewInspect", options),
  previewEdit: (options) => call("previewEdit", options),
  previewClearData: (options) => call("previewClearData", options),
  previewDom: (options) => call("previewDom", options),
  captureLivePreview: (options) => call("captureLivePreview", options),
  // Web page capture and region picking (desktop/capture-remote.cjs, desktop/preview.cjs previewElementAt).
  captureRemote: (options) => call("captureRemote", options),
  captureRemoteProbe: (options) => call("captureRemoteProbe", options),
  previewElementAt: (point) => call("previewElementAt", point),
  // Photographic image providers (desktop/generate.cjs): settings never return the API key.
  imageProvider: {
    get: () => call("imageProviderGet"),
    set: (options) => call("imageProviderSet", options),
    generate: (options) => call("generateImage", options),
  },
  previewApp: (options) => call("previewApp", options),
  exportPDF: (html) => call("exportPDF", html),
  createProject: (options) => call("createProject", options),
  // Code workspace (desktop/repositories.cjs): repository list, per-chat git worktrees, active root; dev server controls.
  repositories: {
    list: () => call("repositoriesList"),
    addLocal: () => call("repositoriesAddLocal"),
    create: (options) => call("repositoriesCreate", options),
    archive: (id) => call("repositoriesArchive", id),
    createChatWorktree: (options) => call("repositoriesCreateChatWorktree", options),
    removeChatWorktree: (options) => call("repositoriesRemoveChatWorktree", options),
    activate: (root) => call("repositoriesActivate", root),
  },
  devServer: {
    dismissProposal: (options) => call("devServerDismissProposal", options),
    configure: (options) => call("devServerConfigure", options),
    setup: (options) => call("devServerSetup", options),
    status: (options) => call("devServerStatus", options),
    start: (options) => call("devServerStart", options),
    stop: (options) => call("devServerStop", options),
  },
  openProject: () => call("openProject"),
  listFiles: () => call("listFiles"),
  readFile: (p) => call("readFile", p),
  writeFile: (p, c) => call("writeFile", p, c),
  gitStatus: () => call("gitStatus"),
  createWorktree: (b) => call("createWorktree", b),
  discoverAgents: () => call("discoverAgents"),
  runAgent: (options) => call("runAgent", options),
  cancelAgent: (id) => call("cancelAgent", id),
  respondAgentPermission: (options) => call("respondAgentPermission", options),
  respondAgentQuestion: (options) => call("respondAgentQuestion", options),
  steerAgent: (options) => call("steerAgent", options),
  listAgentRuns: () => call("listAgentRuns"),
  listAllowRules: (options) => call("listAllowRules", options),
  removeAllowRule: (options) => call("removeAllowRule", options),
  agentToolsVersion: () => call("agentToolsVersion"),
  agentTitle: (options) => call("agentTitle", options),
  gitChanges: (options) => call("gitChanges", options).then(changesResult),
  gitBranchChanges: (options) => call("gitBranchChanges", options).then(changesResult),
  gitDiff: (options) => call("gitDiff", options),
  gitCommit: (options) => call("gitCommit", options),
  gitDiscard: (options) => call("gitDiscard", options),
  gitPush: (options) => call("gitPush", options),
  gitPullRequest: (options) => call("gitPullRequest", options),
  gitCreatePullRequest: (options) => call("gitCreatePullRequest", options),
  designPreferences: {
    list: () => call("designPreferencesList"),
    save: (text) => call("designPreferencesSave", text),
    update: (id, text) => call("designPreferencesUpdate", id, text),
    remove: (id) => call("designPreferencesRemove", id),
  },
  // Design style library (integrations/design-knowledge/styles): [{id,name,summary}] for the composer style picker; [] when unavailable.
  designStylesList: () => call("designStylesList"),
  // Settings › Agents behaviour (desktop/agent-behavior.cjs): follow-ups, response style, attribution, folder, branch prefix, modes, allowed rules.
  agentBehavior: {
    get: () => call("agentBehaviorGet"),
    set: (patch) => call("agentBehaviorSet", patch),
    chooseFolder: () => call("agentBehaviorChooseFolder"),
    outputStyles: () => call("agentOutputStyles"),
    commitAuthor: () => call("agentCommitAuthor"),
    allowList: () => call("agentAllowList"),
    allowRemove: (id) => call("agentAllowRemove", id),
    allowOpen: (groupId) => call("agentAllowOpen", groupId),
  },
  listAgentModels: (options) => call("listAgentModels", options),
  listAgentCommands: (options) => call("listAgentCommands", options),
  designReferencesList: () => call("designReferencesList"),
  designReferencesSave: (options) => call("designReferencesSave", options),
  designReferencesAttach: (options) => call("designReferencesAttach", options),
  designReferencesRemove: (id) => call("designReferencesRemove", id),
  worktreeAddFiles: (options) => call("worktreeAddFiles", options),
  pickWorkingDirectory: () => call("pickWorkingDirectory"),
  terminalRecentOutput: (options) => call("terminalRecentOutput", options),
  saveAgentImage: (options) => call("saveAgentImage", options),
  readMemory: () => call("readMemory"),
  writeMemory: (text) => call("writeMemory", text),
  onAgentEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("desktop:agent-event", listener);
    return () => ipcRenderer.removeListener("desktop:agent-event", listener);
  },
});
