// Keep asynchronous broken-pipe errors from becoming Electron error dialogs.
let exitWithParent = () => {};
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.("error", (error) => {
    if (error?.code === "EPIPE") exitWithParent();
    else if (error?.code !== "ERR_STREAM_DESTROYED") process.emitWarning(error);
  });
}
const { onWindowClosed } = require("./window-cleanup.cjs");
const {
  app,
  BrowserWindow,
  session,
  dialog,
  Notification,
  shell,
  screen,
  protocol,
  net,
  clipboard,
  ClipboardItem,
  nativeImage,
} = require("electron");
const path = require("node:path");
if (
  process.env.VERYNIZE_EXIT_WITH_PARENT === "1" ||
  app.commandLine.hasSwitch("remote-debugging-port")
) {
  let exiting = false;
  exitWithParent = () => {
    if (exiting) return;
    exiting = true;
    // Drain native PTY callbacks before app.exit bypasses the normal quit hooks.
    require("./terminal.cjs")
      .drainTerminals()
      .finally(() => app.exit(0));
  };
  const parent = process.ppid;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch (error) {
      if (error.code === "ESRCH") exitWithParent();
    }
  }, 1000).unref();
}

const { Project } = require("./projects.cjs");
const agents = require("./agents.cjs");
const { registerPreview } = require("./preview.cjs");
const { registerDesignFiles } = require("./design-files.cjs");
const { registerGeneration, imageGenerator } = require("./generate.cjs");
const { registerFigma } = require("./figma.cjs");
const { registerRendering } = require("./render.cjs");
const { registerAgentAuth } = require("./agent-auth.cjs");
const { registerGitChanges } = require("./git-changes.cjs");
const {
  RepositoryRegistry,
  registerRepositories,
  createProjectFolder,
} = require("./repositories.cjs"); // Code workspace: repositories + per-chat worktrees
const mcpBridge = require("./mcp-bridge.cjs"); // agent-bridge hook: live MCP server (getBridgeInfo for agent runtimes)
const { registerAgentRuntime } = require("./agent-runtime.cjs"); // agent chat runtime (Claude Agent SDK / Codex app-server)
const agentBehavior = require("./agent-behavior.cjs"); // Settings › Agents: follow-ups, response style, attribution, folder, branch prefix, modes, allowed rules
// The editor is served from app://verynize/ (desktop/app-protocol.cjs), not file://: IPC trust is
// origin-based, so client-side routes (app://verynize/editor) keep working.
const appProtocol = require("./app-protocol.cjs");
appProtocol.registerSchemes(protocol); // must run before app ready
let editorOpened = false; // set once the first editor window exists (window-all-closed)
let primaryRuntime = null,
  repositories = null,
  behaviorStore = null,
  agentStores = null;
const liveRuntimes = new Set(); // agent runtime of the latest editor window (serves ask_agent)
app.setName("Verynize");
// Crash reports (desktop/telemetry.cjs): main-process error handlers, and Sentry when the user opted in (off by default).
const telemetry = require("./telemetry.cjs");
telemetry.start(app, { dialog });
// Shared storage policy disables keychain access when HOME differs from the OS user home.
// Image keys then remain in session memory; never enable a mock keychain for users.
require("./secure-storage.cjs");
// Linux CI (xvfb, no desktop keyring): use Chromium's basic password store instead of probing D-Bus/libsecret, so
// safeStorage reports encryption unavailable at once (generate.cjs keeps keys in memory, figma-oauth.cjs refuses to persist).
if (process.platform === "linux" && process.env.CI && !app.commandLine.hasSwitch("password-store"))
  app.commandLine.appendSwitch("password-store", "basic");
// Linux CI renders like the macOS dev machines the tests were measured on: a 2x display (Retina) and scrollbars that take
// no panel width, like macOS overlay scrollbars. Chromium 156 (Electron 45) ignores the OverlayScrollbar feature, so
// --hide-scrollbars removes the 15px gutter instead. xvfb has no GPU: compositing stays in software (--disable-gpu, as Chromium falls back
// to anyway) and WebGL gets its SwiftShader fallback, or shaders never become ready. Compositing through SwiftShader GL
// (use-angle=swiftshader) instead loses clicks into out-of-process iframes and delays frames (preview, mask pixels).
if (process.platform === "linux" && process.env.CI) {
  const sw = app.commandLine;
  if (!sw.hasSwitch("force-device-scale-factor")) sw.appendSwitch("force-device-scale-factor", "2");
  sw.appendSwitch("hide-scrollbars");
  sw.appendSwitch("disable-gpu");
  sw.appendSwitch("enable-unsafe-swiftshader");
}
require("./app-preferences.cjs").attachDeepLinks(app); // verynize:// design links (Settings › Preferences › Advanced)
void app.whenReady().then(async () => {
  appProtocol.registerHandler(protocol, net);
  require("./assets.cjs").register();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  require("./cloud-defaults.cjs").guardProduction(session.defaultSession); // automated runs never reach the production cloud
  const storageMigration = require("./storage-migration.cjs");
  const migration = await storageMigration.migrateStorage({ app, BrowserWindow }); // one-time file:// → app://verynize localStorage/IndexedDB copy; applies staged old-build edits
  // Design preferences: one file shared by the agent persona (agent-runtime.cjs) and the MCP tools.
  if (!process.env.VERYNIZE_PREFERENCES)
    process.env.VERYNIZE_PREFERENCES = path.join(
      app.getPath("userData"),
      "design-preferences.json",
    );
  // ask_agent MCP tool: nested read-only helper run on the most recent window's agent runtime.
  const askAgent = (options) => {
    if (!primaryRuntime) return Promise.reject(Error("The agent runtime is not ready"));
    return primaryRuntime.askTool(options || {});
  }; // gated by Settings › Agents › Access
  behaviorStore = new agentBehavior.AgentBehaviorStore({
    file: path.join(app.getPath("userData"), "agent-behavior.json"),
  });
  const behaviorFolder = async () => agentBehavior.folderOf(await behaviorStore.get());
  repositories = new RepositoryRegistry({
    file: path.join(app.getPath("userData"), "repositories.json"),
    workspacesRoot: async () => agentBehavior.workspacesOf(await behaviorStore.get()),
    branchPrefix: async () => agentBehavior.resolveBranchPrefix(await behaviorStore.get()),
  });
  // Named accounts, Verynize MCP servers/permission defaults and per-chat autonomy: one store each for all windows.
  agentStores = {
    profiles: new (require("./agent-profiles.cjs").AgentProfiles)({
      userData: app.getPath("userData"),
    }),
    tools: new (require("./agent-tool-config.cjs").AgentToolConfig)({
      userData: app.getPath("userData"),
    }),
    autonomy: new (require("./agent-autonomy.cjs").AgentAutonomy)({
      userData: app.getPath("userData"),
    }),
  };
  agentStores.siwc = new (require("./chatgpt-auth.cjs").ChatGPTAuth)({
    userData: app.getPath("userData"),
    profiles: agentStores.profiles,
    openExternal: (url) => shell.openExternal(url),
    notice: async () => {
      const result = await dialog.showMessageBox({
        type: "info",
        title: "Use your ChatGPT plan in Verynize",
        message: "Continue with ChatGPT",
        detail:
          "Verynize is an independent MIT-licensed app. OpenAI shares your account identity and tokens with this desktop app. Tokens stay in protected files on this Mac. Your prompts, attachments and tool results are sent to OpenAI to fulfill your requests; local Codex tools can access files according to your selected permissions. Eligible requests, including chat titles and helpers triggered by your activity, use your ChatGPT plan and its limits. This connection is free. Manage access and usage at chatgpt.com/settings/usage. Verynize does not upload these tokens to its servers.",
        buttons: ["Continue with ChatGPT", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      });
      return result.response === 0;
    },
    welcome: () =>
      dialog.showMessageBox({
        type: "info",
        title: "Verynize",
        message: "You're using your ChatGPT plan",
        detail:
          "Eligible AI requests in Verynize use your ChatGPT plan. You can manage usage and disconnect Verynize in ChatGPT Settings → Usage.",
        buttons: ["Got it"],
      }),
  });
  mcpBridge
    .startBridge(app, { askAgent, generateImage: (options) => imageGenerator.generate(options) })
    .catch((error) => console.error("MCP bridge failed to start:", error)); // agent-bridge hook
  // Editor windows only: the storage probe's hidden window must not count as an open editor on macOS activate.
  const editorWindows = new Set();
  const createWindow = () => {
    // Keep normal/restored bounds inside the display; an oversized initial window is clamped
    // by macOS but retains off-screen restore bounds, making zoom/resize inconsistent.
    const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(1440, workArea.width),
      height = Math.min(950, workArea.height);
    const win = new BrowserWindow({
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 12, y: 13 } }
        : {}),
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
      minWidth: Math.min(900, workArea.width),
      minHeight: Math.min(600, workArea.height),
      backgroundColor: "#141416",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        additionalArguments: telemetry.rendererArguments(),
      },
    });
    // Off macOS the default Electron menu would be a window menu bar: the shell draws its own (AppMenu), and the bar's
    // Alt focus/mnemonics and Ctrl accelerators (Ctrl+Shift+I, Ctrl+R, Ctrl+0/±) would compete with editor shortcuts.
    if (process.platform !== "darwin") win.removeMenu();
    let project = null,
      agentRuntime = null;
    const agentsBusy = () => agentRuntime?.active() > 0;
    const current = () => {
      if (!project) throw Error("Open a project folder first");
      return project;
    };
    /** @type {import("./ipc-contract").Handle} */
    const handle = (name, fn) =>
      win.webContents.ipc.handle("desktop:" + name, (event, ...args) => {
        if (!appProtocol.isTrustedSender(event, win)) throw Error("Untrusted IPC sender");
        return fn.apply(undefined, args);
      });
    handle("writeClipboardImage", async (dataURL) => {
      if (
        typeof dataURL !== "string" ||
        !dataURL.startsWith("data:image/png;base64,") ||
        dataURL.length > 200 * 1024 * 1024
      )
        throw Error("Invalid clipboard PNG");
      const image = nativeImage.createFromDataURL(dataURL);
      if (image.isEmpty()) throw Error("Invalid clipboard PNG");
      await clipboard.write([
        new ClipboardItem({ "image/png": new Blob([image.toPNG()], { type: "image/png" }) }),
      ]);
    });
    registerPreview(handle, win);
    const designFiles = registerDesignFiles(handle, win);
    mcpBridge.registerWindow(win, {
      designFiles,
      trusted: (event) => appProtocol.isTrustedSender(event, win),
    }); // agent-bridge hook
    registerGeneration(handle, win);
    registerFigma(handle, win);
    require("./figma-oauth.cjs").registerFigmaOAuth(handle, win); // Figma account (OAuth PKCE, safeStorage tokens)
    registerRendering(handle, win);
    require("./html-import.cjs").registerHtmlImport(handle, win); // Import HTML: codec-html importer (stylesheets, cascade, viewport, :root variables)
    registerAgentAuth(handle, win, { profiles: agentStores.profiles, siwc: agentStores.siwc });
    // Settings › Preferences (desktop/app-preferences.cjs): soundChoose/soundRead/soundClear, linksReady/linksSetEnabled, worktreeLineStats.
    require("./app-preferences.cjs").registerAppPreferences(handle, win, {
      app,
      dialog,
      registry: repositories,
      userData: app.getPath("userData"),
    });
    // Settings › Usage and Memory (desktop/agent-usage.cjs, desktop/agent-memory.cjs): agentUsage, agentLayerUsage, agentMemory*.
    const agentUsage = require("./agent-usage.cjs").registerAgentUsage(handle, {
      userData: app.getPath("userData"),
      profiles: agentStores.profiles,
      siwc: agentStores.siwc,
    });
    // Settings › Accounts / Tools and the chat Autonomy panel: agentProfiles*, agentToolConfig*, agentAutonomy{Get,Set}.
    require("./agent-profiles.cjs").registerAgentProfiles(handle, {
      store: agentStores.profiles,
      usage: agentUsage,
      siwc: agentStores.siwc,
    });
    require("./agent-tool-config.cjs").registerAgentToolConfig(handle, {
      store: agentStores.tools,
    });
    require("./agent-autonomy.cjs").registerAgentAutonomy(handle, { store: agentStores.autonomy });
    require("./agent-memory.cjs").registerAgentMemory(handle, {
      userData: app.getPath("userData"),
      shell,
    });
    // First-run onboarding (web/src/islands/onboarding): automated runs skip it with VERYNIZE_SKIP_ONBOARDING=1.
    handle("onboardingState", () => ({ skip: process.env.VERYNIZE_SKIP_ONBOARDING === "1" }));
    telemetry.registerTelemetry(handle); // Settings › Preferences › Privacy: telemetryGet, telemetrySet
    require("./cloud-defaults.cjs").registerCloudDefaults(handle); // Share panel server default: production or VERYNIZE_CLOUD_SERVER
    handle("openExternal", (value) => {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw Error("Only HTTP and HTTPS links are supported");
      return shell.openExternal(url.href);
    });
    let lastNotification = 0;
    handle("notifyTask", (options) => {
      if (!options || typeof options.title !== "string" || typeof options.body !== "string")
        throw Error("Invalid notification");
      if (Date.now() - lastNotification < 3000 || !Notification.isSupported()) return false;
      lastNotification = Date.now();
      new Notification({
        title: options.title.slice(0, 120),
        body: options.body.slice(0, 300),
      }).show();
      return true;
    });
    // Legacy single-project entry points: the chosen folder is also added to the repository list.
    handle("openProject", async () => {
      if (agentsBusy()) throw Error("Stop running agents before switching projects");
      const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
      if (result.canceled) return null;
      const repo = await repositories.add(result.filePaths[0]);
      project = await Project.open(repo.root);
      return { root: project.root, name: path.basename(project.root), repoId: repo.id };
    });
    handle("createProject", async (options) => {
      if (agentsBusy()) throw Error("Stop running agents before switching projects");
      if (
        !options ||
        typeof options.name !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(options.name)
      )
        throw Error("Use a project name with letters, numbers, dashes, or underscores");
      if (
        options.repository &&
        !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(
          options.repository,
        )
      )
        throw Error("Use an HTTPS GitHub repository URL");
      const parent = await behaviorFolder();
      await require("node:fs/promises").mkdir(parent, { recursive: true }); // new projects go to the Verynize folder
      const repo = await repositories.add(await createProjectFolder(parent, options));
      project = await Project.open(repo.root);
      return { root: project.root, name: path.basename(project.root), repoId: repo.id };
    });
    // --- Code workspace (desktop/repositories.cjs): repositories*, per-chat worktrees, setActiveRoot (repositoriesActivate) ---
    registerRepositories(handle, win, {
      registry: repositories,
      dialog,
      getProject: () => project,
      setProject: (value) => {
        project = value;
      },
      Project,
      projectsRoot: behaviorFolder,
    });
    handle("listFiles", () => current().list());
    handle("readFile", (p) => current().read(p));
    handle("writeFile", (p, c) => current().write(p, c));
    handle("gitStatus", () => current().status());
    handle("createWorktree", async (b) =>
      current().worktree(b, {
        parent: path.join(
          agentBehavior.workspacesOf(await behaviorStore.get()),
          path.basename(current().root),
        ),
      }),
    );
    // Changes panel (desktop/git-changes.cjs): gitChanges, gitBranchChanges, gitDiff, gitCommit, gitDiscard, gitPush, gitPullRequest, gitCreatePullRequest.
    registerGitChanges(handle, { getProject: () => project });
    require("./app-publish.cjs").registerAppPublish(handle, { getProject: () => project }); // Share › Publish app: cloudAppDetect, cloudAppPublish
    require("./cloud-passkey.cjs").registerCloudPasskey(handle, win); // Share › Account passkeys: cloudPasskeyOpen, cloudPasskeyClose
    handle("readMemory", () => current().memory());
    handle("writeMemory", (text) => current().write("VERYNIZE.md", text));
    handle("discoverAgents", () => agents.discover());
    // --- agent chat runtime (desktop/agent-runtime.cjs): runAgent, cancelAgent, respondAgentPermission, listAgentModels, saveAgentImage ---
    // --- also: respondAgentQuestion, steerAgent, listAgentRuns, listAllowRules, removeAllowRule, agentToolsVersion, agentTitle, designPreferences*, designStylesList ---
    agentRuntime = registerAgentRuntime(handle, win, {
      userData: app.getPath("userData"),
      getProject: () => project,
      resolveProject: async (root) => {
        const resolved = await repositories.resolveRoot(root);
        const opened = await Project.open(resolved.root);
        opened.repositoryRoot = resolved.repository.root;
        return opened;
      },
      getBehavior: () => behaviorStore.get(),
      ...agentStores,
    });
    const windowRuntime = agentRuntime;
    liveRuntimes.add(windowRuntime);
    onWindowClosed(win, () => liveRuntimes.delete(windowRuntime));
    // Global search and history-preserving moves (desktop/project-search.cjs, desktop/repository-moves.cjs): projectSearch*, repositoryMove*, repositoryRelocate.
    require("./project-search.cjs").registerProjectSearch(handle, {
      registry: repositories,
      shell,
    });
    require("./template-packs.cjs").registerTemplatePacks(handle); // Templates gallery: .zip packs (templatePackEncode/Decode)
    require("./repository-moves.cjs").registerRepositoryMoves(handle, {
      registry: repositories,
      dialog,
      win,
      busy: async (root) => {
        const data = await repositories.load();
        const repo = data.repositories.find((r) => r.root === root);
        const roots = [
          root,
          ...(repo ? data.worktrees.filter((w) => w.repoId === repo.id).map((w) => w.path) : []),
        ];
        return [...liveRuntimes].some((rt) =>
          [...rt.runs.values()].some((r) =>
            roots.some((x) => r.cwd === x || String(r.cwd).startsWith(x + path.sep)),
          ),
        );
      },
    });
    agentBehavior.registerAgentBehavior(handle, win, {
      store: behaviorStore,
      registry: repositories,
      dialog,
      shell,
      getRuntime: () => agentRuntime,
      userData: app.getPath("userData"),
    });
    primaryRuntime = agentRuntime;
    onWindowClosed(win, () => {
      if (primaryRuntime === agentRuntime) primaryRuntime = null;
    });
    // Settings › Agents (desktop/agent-tools.cjs): agentProviderAccounts, agentMcp{List,Add,Remove,Login}, agentAccess{Get,Set}
    require("./agent-tools.cjs").registerAgentTools(handle, win, {
      userData: app.getPath("userData"),
      getRuntime: () => agentRuntime,
      siwc: agentStores.siwc,
    });
    // Chat composer "+" menu and slash commands: listAgentCommands (desktop/agent-commands.cjs); designReferences*, worktreeAddFiles, pickWorkingDirectory (desktop/chat-attachments.cjs).
    require("./agent-commands.cjs").registerAgentCommands(handle, {
      getRuntime: () => agentRuntime,
    });
    require("./chat-attachments.cjs").registerChatAttachments(handle, win, {
      userData: app.getPath("userData"),
      dialog,
      resolveRoot: (root) => repositories.resolveRoot(root),
    });
    // Composer indicators (desktop/agent-live-status.cjs): agentLiveMcpStatus, agentLiveContext.
    require("./agent-live-status.cjs").registerAgentLiveStatus(handle, {
      getRuntime: () => agentRuntime,
    });
    // --- agent shell (desktop/agent-shell.cjs): open project for the dev server / terminal MCP tools ---
    require("./agent-shell.cjs").registerShellWindow(win, { getProject: () => project });
    require("./agent-shell.cjs").registerDevServerIPC(handle, {
      getProject: () => project,
      resolveRoot: (root) => repositories.resolveRoot(root),
    }); // devServerStatus/Start/Stop for the Start preview button
    // --- end agent shell ---
    // --- integrated terminal (desktop/terminal.cjs): terminalCreate, terminalWrite, terminalResize, terminalKill ---
    // PTY shells for the code-mode terminal panel; output arrives as desktop:terminal-data / desktop:terminal-exit.
    // The cwd guard accepts the open project (and its worktrees) or ~/Verynize/workspaces/; the repository registry
    // can install its own policy with require('./terminal.cjs').setTerminalCwdValidator(fn).
    require("./terminal.cjs").registerTerminal(handle, win, { getProject: () => project });
    // Registered repository roots and their chat worktrees may host a terminal even when another chat is active.
    require("./terminal.cjs").setTerminalCwdValidator(async (real, { defaultAllowed }) => {
      if (defaultAllowed) return true;
      try {
        await repositories.resolveRoot(real);
        return true;
      } catch {
        return false;
      }
    });
    // --- end integrated terminal ---
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // Same-origin navigations (a client-side route reloaded as app://verynize/editor) are allowed; anything else is blocked.
    win.webContents.on("will-navigate", (event, url) => {
      if (!appProtocol.isAppURL(url)) event.preventDefault();
    });
    win.webContents.on("will-redirect", (event, url) => {
      if (!appProtocol.isAppURL(url)) event.preventDefault();
    });
    // Plain launches open Files. A cold-start design link keeps the editor entry, and so do automated editor tests
    // (VERYNIZE_LAUNCH_EDITOR=1), which exercise the editor rather than the launch.
    const editorFirst =
      require("./app-preferences.cjs").hasPendingLinks() ||
      process.env.VERYNIZE_LAUNCH_EDITOR === "1";
    void win.loadURL(editorFirst ? `${appProtocol.ORIGIN}/editor` : appProtocol.ENTRY_URL);
    editorWindows.add(win);
    editorOpened = true;
    win.on("closed", () => editorWindows.delete(win));
    return win;
  };
  storageMigration.probeAfterLaunch({
    app,
    BrowserWindow,
    editor: createWindow(),
    startup: migration,
  }); // background check for old-build (file://) edits, staged for the next launch
  app.on("activate", () => {
    if (!editorWindows.size) createWindow();
  });
});
app.on("will-quit", () => mcpBridge.stopBridge()); // agent-bridge hook
// Before the first editor opens, the only windows are storage-migration.cjs's hidden copy pages: destroying the last of
// them is not the user closing the app (on Linux/Windows that used to quit before the editor ever opened).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && editorOpened) app.quit();
});
