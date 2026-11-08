// The typed `window.desktop` contract: everything desktop/preload.cjs exposes, one member per preload method.
// Islands reach it through `platform.desktop` (./platform.ts), never through a `window` cast. Result types that an
// island owns stay in that island and are imported here as types only; methods only legacy scripts call are
// `Untyped`. DESKTOP_API_SHAPE mirrors the member tree: tsc fails when it and DesktopApi differ, and
// tests/platform-contract.cjs fails when it and the preload differ. Adding a preload method means adding it here.
//
// This file is loaded by Node's type stripping in that test: keep it free of runtime imports and non-erasable
// syntax (enums, namespaces, parameter properties).
import type {
  Agent,
  Autonomy,
  MoveResult,
  Profile,
  ProfileList,
  ProfileStatus,
  SearchResult,
  PermissionRule,
  ToolServer,
} from "@/islands/settings/workspace-ipc";
import type { AppPreferencesApi } from "@/islands/settings/preference-runtime";
import type { TelemetryIpc } from "./telemetry/types.js";
import type { BehaviorIpc } from "@/islands/settings/behavior-store";
import type { AgentToolsIpc } from "@/islands/settings/agents-tools";
import type { AllowRule, PreferencesIpc } from "@/islands/settings/agent-memory";
import type { MemoryIpc } from "@/islands/settings/memory";
import type { UsageIpc } from "@/islands/settings/usage";
import type { ContextBreakdown, McpSnapshot } from "@/islands/chat/agent-status";
import type { ChangesSummary, GitApi } from "@/islands/chat/changes";
import type { AgentCommand, ReferenceCollection } from "@/islands/chat/composer-actions";
import type {
  DevServerStatus,
  PreviewConfigInput,
  ProjectFile,
  Repository,
  Worktree,
} from "@/islands/code/api";
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSession,
} from "@/islands/code/terminal/bridge";
import type { FontEntry } from "@/islands/inspector/fonts";

/** A preload method that only legacy scripts (web/*.js) call; its payloads are documented in desktop/README.md. */
export type Untyped = (...args: unknown[]) => Promise<unknown>;
type Unsubscribe = () => void;

/** Agent runtime event (desktop/agent-runtime.cjs): `{id, chatId, seq, type, …}`; consumers narrow by `type`. */
export type AgentEvent = {
  type: string;
  id?: string;
  chatId?: string;
  seq?: number;
  [key: string]: unknown;
};
export type AuthEvent = {
  id: string;
  agent: string;
  profile?: string;
  type: string;
  message: string;
};
export type RenderResult = {
  dataURL: string;
  width: number;
  height: number;
  scale?: number;
  requestedScale?: number;
};
export type PreviewTarget = { target?: string };
export type CapturedPreview = {
  document?: { pages: { nodes: { id: string; parentId: string | null }[] }[] };
};

export interface DesktopApi {
  // Agent sign-in and onboarding (desktop/agent-auth.cjs).
  agentAccountStatus(options: { agent: Agent; profile?: string }): Promise<ProfileStatus>;
  startAgentLogin(options: {
    agent: Agent | (string & {});
    profile?: string;
  }): Promise<{ id: string }>;
  cancelAgentLogin(options: { id: string }): Promise<unknown>;
  agentLogout(options: { agent: Agent; profile?: string }): Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  onboardingState(): Promise<{ skip: boolean }>;
  /** Share panel server default (desktop/cloud-defaults.cjs): production, or VERYNIZE_CLOUD_SERVER. */
  cloudDefaults(): Promise<{ server: string }>;
  onAuthEvent(callback: (event: AuthEvent) => void): Unsubscribe;
  writeClipboardImage(dataURL: string): Promise<void>;
  notifyTask(options: { title: string; body: string }): Promise<boolean>;
  // Share › Publish app and passkeys (desktop/app-publish.cjs, desktop/cloud-passkey.cjs).
  cloudAppDetect: Untyped;
  cloudAppPublish: Untyped;
  cloudPasskeyOpen: Untyped;
  cloudPasskeyClose: Untyped;
  appPreferences: AppPreferencesApi;
  /** Crash reports, opt-in (desktop/telemetry.cjs). */
  telemetry: TelemetryIpc;
  agentUsage: UsageIpc;
  agentProfiles: {
    list(): Promise<ProfileList>;
    add(options: { agent: Agent; name: string }): Promise<Profile>;
    rename(options: { id: string; name: string }): Promise<Profile>;
    remove(options: { id: string }): Promise<unknown>;
    setDefault(options: { agent: Agent; id: string }): Promise<unknown>;
    setChat(options: {
      chatId: string;
      agent: Agent;
      id: string | null;
    }): Promise<{ accounts: Partial<Record<Agent, string>> }>;
    chat(options: { chatId: string }): Promise<Partial<Record<Agent, string>>>;
  };
  agentToolConfig: {
    list(): Promise<{ servers: ToolServer[]; permissions: PermissionRule[] }>;
    saveServer(options: Record<string, unknown>): Promise<ToolServer>;
    setEnabled(options: { id: string; enabled: boolean }): Promise<ToolServer>;
    removeServer(options: { id: string }): Promise<unknown>;
    setPermission(options: Record<string, unknown>): Promise<unknown>;
  };
  agentAutonomy: {
    get(options: { chatId: string }): Promise<Autonomy>;
    set(options: { chatId: string; settings: Autonomy }): Promise<Autonomy>;
  };
  templatePacks: { encode: Untyped; decode: Untyped };
  projectSearch: {
    search(options: {
      query: string;
      regex?: boolean;
      caseSensitive?: boolean;
      projectIds?: string[];
      designFiles?: boolean;
    }): Promise<SearchResult>;
    open(options: { root: string; path: string; reveal?: boolean }): Promise<unknown>;
  };
  repositoryMoves: {
    moveInside(options: { repoId: string; from: string; to: string }): Promise<MoveResult>;
    relocate(options: { repoId: string; name?: string; destination?: string }): Promise<MoveResult>;
    moveAcross(options: {
      sourceRepoId: string;
      path: string;
      targetRepoId: string;
      to: string;
      strategy: "patches" | "subtree";
    }): Promise<MoveResult>;
    chooseDestination(): Promise<string | null>;
  };
  agentLiveStatus: {
    mcp: (options: { agent: string; chatId?: string | null }) => Promise<Omit<McpSnapshot, "at">>;
    context: (options: { chatId?: string | null }) => Promise<ContextBreakdown | null>;
  };
  agentMemory: MemoryIpc;
  // Integrated terminal (desktop/terminal.cjs).
  terminalCreate(options: { cwd: string; cols?: number; rows?: number }): Promise<TerminalSession>;
  terminalWrite(options: { id: string; data: string }): Promise<boolean>;
  terminalResize(options: { id: string; cols: number; rows: number }): Promise<boolean>;
  terminalKill(options: { id: string }): Promise<boolean>;
  onTerminalData(callback: (event: TerminalDataEvent) => void): Unsubscribe;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): Unsubscribe;
  reviewAgent: Untyped;
  agentTools: AgentToolsIpc;
  agentBridge: {
    onCall(
      callback: (request: { requestId: string; op: string; args: unknown }) => void,
    ): Unsubscribe;
    reply(
      requestId: string,
      payload: { ok: true; result: unknown } | { ok: false; error: string },
    ): void;
  };
  // Rendering, fonts and export (desktop/render.cjs).
  renderDesign(options: {
    screenshot?: boolean;
    html: string;
    width: number;
    height: number;
    scale: number;
  }): Promise<RenderResult>;
  fontFaces: (
    families: { family: string; weights: number[]; styles: string[] }[],
  ) => Promise<{ css: string }>;
  renderPDF(options: {
    html: string;
    width: number;
    height: number;
    title?: string;
  }): Promise<RenderResult>;
  saveExport(options: {
    name: string;
    data: string;
    extension: string;
  }): Promise<{ path: string; name: string; bytes: number } | null>;
  fontCatalog(): Promise<{ fonts: FontEntry[]; source: string }>;
  exportCode(options: Record<string, unknown>): Promise<{ content: string; extension: string }>;
  importHtml: Untyped;
  importHtmlFile: Untyped;
  // Figma import (desktop/figma*.cjs).
  importFigma: Untyped;
  figmaClipboard: Untyped;
  figmaFile: Untyped;
  figmaFileOpen: Untyped;
  figmaOAuth: {
    status: Untyped;
    configure: Untyped;
    connect: Untyped;
    cancel: Untyped;
    disconnect: Untyped;
  };
  // Native design files (desktop/design-files.cjs).
  designDetach: Untyped;
  designOpen: Untyped;
  designSave: Untyped;
  designReload: Untyped;
  onDesignFileChanged: Untyped;
  // Version history sidecar of the open native file (desktop/design-files.cjs).
  versionsList: Untyped;
  versionsGet: Untyped;
  versionsAdd: Untyped;
  // Running-app preview frames, Preview Edit and web capture (desktop/preview*.cjs, desktop/capture-remote.cjs).
  previewInput: Untyped;
  previewOpenBrowser(options?: PreviewTarget): Promise<unknown>;
  previewLocation(options?: PreviewTarget): Promise<{ url: string }>;
  previewNavigate(
    options: PreviewTarget & { direction: string; ignoreCache?: boolean },
  ): Promise<unknown>;
  onPreviewNavigated: Untyped;
  previewInspect: Untyped;
  previewEdit: Untyped;
  previewClearData: (options: { url: string; logins: boolean }) => Promise<unknown>;
  previewDom: Untyped;
  captureLivePreview(
    options: PreviewTarget & { url: string; region?: unknown },
  ): Promise<CapturedPreview>;
  captureRemote: Untyped;
  captureRemoteProbe: Untyped;
  previewElementAt(point: PreviewTarget & { x: number; y: number }): Promise<unknown>;
  imageProvider: { get: Untyped; set: Untyped; generate: Untyped };
  previewApp(options: { url: string }): Promise<unknown>;
  exportPDF: Untyped;
  // Projects, repositories, dev server and git (desktop/projects.cjs, repositories.cjs, dev-server.cjs, git-changes.cjs).
  createProject(options: {
    name: string;
    repository?: string;
  }): Promise<{ root: string; name: string; repoId: string }>;
  repositories: {
    list(): Promise<{ repositories: Repository[]; active: { root: string } | null }>;
    addLocal(): Promise<Repository | null>;
    create(options: { name: string; repository?: string }): Promise<Repository | null>;
    archive(id: string): Promise<boolean>;
    createChatWorktree(options: { repoId: string; chatId: string }): Promise<Worktree>;
    removeChatWorktree(options: {
      repoId: string;
      chatId: string;
      force?: boolean;
    }): Promise<boolean>;
    activate(root: string | null): Promise<unknown>;
  };
  devServer: {
    dismissProposal(options: { root: string; saved?: boolean }): Promise<unknown>;
    configure(options: PreviewConfigInput): Promise<DevServerStatus>;
    setup(options?: {
      root?: string;
    }): Promise<{ exitCode: number; output?: string; setup?: string[]; recovery?: string }>;
    status(options?: { root?: string; tail?: number }): Promise<DevServerStatus>;
    start(options?: { root?: string }): Promise<DevServerStatus>;
    stop(options?: { root?: string }): Promise<DevServerStatus>;
  };
  openProject(): Promise<{ root: string; name: string; repoId: string } | null>;
  listFiles(): Promise<ProjectFile[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<boolean>;
  gitStatus: Untyped;
  createWorktree: Untyped;
  // Agent runs (desktop/agent-runtime.cjs).
  discoverAgents: Untyped;
  runAgent: Untyped;
  cancelAgent: Untyped;
  respondAgentPermission: Untyped;
  respondAgentQuestion: Untyped;
  steerAgent: Untyped;
  listAgentRuns: Untyped;
  listAllowRules: (options?: { projectKey?: string }) => Promise<AllowRule[]>;
  removeAllowRule(rule: unknown): Promise<unknown>;
  agentToolsVersion: Untyped;
  agentTitle: Untyped;
  gitChanges(options: { root?: string }): Promise<ChangesSummary>;
  gitBranchChanges(options: {
    root?: string;
  }): Promise<{ base: string | null; files: { path: string; status: string }[] }>;
  gitDiff: GitApi["gitDiff"];
  gitCommit: GitApi["gitCommit"];
  gitDiscard: GitApi["gitDiscard"];
  gitPush: GitApi["gitPush"];
  gitPullRequest: GitApi["gitPullRequest"];
  gitCreatePullRequest: GitApi["gitCreatePullRequest"];
  designPreferences: PreferencesIpc;
  designStylesList: () => Promise<{ id: string; name: string; summary?: string }[]>;
  agentBehavior: BehaviorIpc;
  // Composer: slash commands, design references, worktree files (desktop/agent-commands.cjs, chat-attachments.cjs).
  listAgentModels: Untyped;
  listAgentCommands: (options: {
    agent: string;
    root?: string | null;
  }) => Promise<{ commands: AgentCommand[] }>;
  designReferencesList(): Promise<ReferenceCollection[]>;
  designReferencesSave(options: { name: string; images: string[] }): Promise<ReferenceCollection>;
  designReferencesAttach(options: {
    id: string;
    chatId: string;
  }): Promise<{ path: string; name: string }[]>;
  designReferencesRemove: Untyped;
  worktreeAddFiles(options: { root: string; folder: boolean }): Promise<{ added: string[] } | null>;
  pickWorkingDirectory(): Promise<string | null>;
  terminalRecentOutput(options: {
    cwd?: string | null;
  }): Promise<{ id: string; cwd: string; text: string } | null>;
  saveAgentImage: Untyped;
  readMemory(): Promise<string>;
  writeMemory(text: string): Promise<boolean>;
  onAgentEvent(callback: (event: AgentEvent) => void): Unsubscribe;
}

type ApiShape<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? true : ApiShape<T[K]>;
};

/** The DesktopApi member tree as data (true = method). Compared with desktop/preload.cjs by tests/platform-contract.cjs. */
export const DESKTOP_API_SHAPE = {
  agentAccountStatus: true,
  startAgentLogin: true,
  cancelAgentLogin: true,
  agentLogout: true,
  openExternal: true,
  onboardingState: true,
  cloudDefaults: true,
  onAuthEvent: true,
  notifyTask: true,
  cloudAppDetect: true,
  cloudAppPublish: true,
  cloudPasskeyOpen: true,
  cloudPasskeyClose: true,
  appPreferences: {
    chooseSound: true,
    readSound: true,
    clearSound: true,
    linksReady: true,
    setLinksEnabled: true,
    worktreeLineStats: true,
    onOpenLink: true,
  },
  telemetry: { config: true, get: true, set: true },
  agentUsage: { read: true, layers: true },
  agentProfiles: {
    list: true,
    add: true,
    rename: true,
    remove: true,
    setDefault: true,
    setChat: true,
    chat: true,
  },
  agentToolConfig: {
    list: true,
    saveServer: true,
    setEnabled: true,
    removeServer: true,
    setPermission: true,
  },
  agentAutonomy: { get: true, set: true },
  templatePacks: { encode: true, decode: true },
  projectSearch: { search: true, open: true },
  repositoryMoves: { moveInside: true, relocate: true, moveAcross: true, chooseDestination: true },
  agentLiveStatus: { mcp: true, context: true },
  agentMemory: { overview: true, reveal: true, open: true },
  terminalCreate: true,
  terminalWrite: true,
  terminalResize: true,
  terminalKill: true,
  onTerminalData: true,
  onTerminalExit: true,
  reviewAgent: true,
  agentTools: {
    accounts: true,
    listServers: true,
    addServer: true,
    removeServer: true,
    loginServer: true,
    getAccess: true,
    setAccess: true,
  },
  writeClipboardImage: true,
  agentBridge: { onCall: true, reply: true },
  renderDesign: true,
  fontFaces: true,
  renderPDF: true,
  saveExport: true,
  fontCatalog: true,
  exportCode: true,
  importHtml: true,
  importHtmlFile: true,
  importFigma: true,
  figmaClipboard: true,
  figmaFile: true,
  figmaFileOpen: true,
  figmaOAuth: { status: true, configure: true, connect: true, cancel: true, disconnect: true },
  designDetach: true,
  designOpen: true,
  designSave: true,
  designReload: true,
  onDesignFileChanged: true,
  versionsList: true,
  versionsGet: true,
  versionsAdd: true,
  previewInput: true,
  previewOpenBrowser: true,
  previewLocation: true,
  previewNavigate: true,
  onPreviewNavigated: true,
  previewInspect: true,
  previewEdit: true,
  previewClearData: true,
  previewDom: true,
  captureLivePreview: true,
  captureRemote: true,
  captureRemoteProbe: true,
  previewElementAt: true,
  imageProvider: { get: true, set: true, generate: true },
  previewApp: true,
  exportPDF: true,
  createProject: true,
  repositories: {
    list: true,
    addLocal: true,
    create: true,
    archive: true,
    createChatWorktree: true,
    removeChatWorktree: true,
    activate: true,
  },
  devServer: {
    dismissProposal: true,
    configure: true,
    setup: true,
    status: true,
    start: true,
    stop: true,
  },
  openProject: true,
  listFiles: true,
  readFile: true,
  writeFile: true,
  gitStatus: true,
  createWorktree: true,
  discoverAgents: true,
  runAgent: true,
  cancelAgent: true,
  respondAgentPermission: true,
  respondAgentQuestion: true,
  steerAgent: true,
  listAgentRuns: true,
  listAllowRules: true,
  removeAllowRule: true,
  agentToolsVersion: true,
  agentTitle: true,
  gitChanges: true,
  gitBranchChanges: true,
  gitDiff: true,
  gitCommit: true,
  gitDiscard: true,
  gitPush: true,
  gitPullRequest: true,
  gitCreatePullRequest: true,
  designPreferences: { list: true, save: true, update: true, remove: true },
  designStylesList: true,
  agentBehavior: {
    get: true,
    set: true,
    chooseFolder: true,
    outputStyles: true,
    commitAuthor: true,
    allowList: true,
    allowRemove: true,
    allowOpen: true,
  },
  listAgentModels: true,
  listAgentCommands: true,
  designReferencesList: true,
  designReferencesSave: true,
  designReferencesAttach: true,
  designReferencesRemove: true,
  worktreeAddFiles: true,
  pickWorkingDirectory: true,
  terminalRecentOutput: true,
  saveAgentImage: true,
  readMemory: true,
  writeMemory: true,
  onAgentEvent: true,
} as const satisfies ApiShape<DesktopApi>;
