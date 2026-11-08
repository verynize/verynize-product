// Typed access to the legacy settings module (web/settings.js) and the globals it drives.
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";

export type SectionId =
  | "account"
  | "preferences"
  | "agents"
  | "accounts"
  | "tools"
  | "projects"
  | "usage"
  | "models"
  | "connections"
  | "memory"
  | "permissions"
  | "members";

export type Preferences = {
  theme: "system" | "light" | "dark";
  reduceMotion: boolean;
  smallNudge: number;
  largeNudge: number;
  selection: "classic" | "deep";
  displayName: string;
  notifications: boolean;
  sound: "none" | "chime" | "bell" | "marimba" | "crystal" | "rise" | "droplet" | "pop" | "custom";
  cloudServer: string;
  // Preferences › Notifications / Advanced (behaviour in preference-runtime.ts, the code and chat islands).
  customSoundName: string;
  chatTabs: boolean;
  lineChanges: boolean;
  openLinksInApp: boolean;
  attachSelection: boolean;
  openPullRequest: boolean;
};

export type AgentInfo = { id: string; available: boolean };
export type AuthKind = "check" | "login" | "logout" | "cancel";

type SettingsState = {
  open: boolean;
  section: SectionId;
  status: string;
  accounts: Record<string, string>;
};

export type SettingsApi = {
  open(section?: string): void;
  close(): void;
  select(id: SectionId): void;
  getState(): SettingsState;
  sections: { id: SectionId; title: string }[];
  attach(renderer: { update(): void; status(text: string): void }): void;
  actions: {
    saveModels(values: AgentDefaults): void;
    saveMemory(text: string): void;
    openMemory(): void;
    saveCloud(value: string): boolean;
    openFigma(): void;
    copyMcp(): Promise<void>;
    openAgent(): void;
    share(): void;
    discoverAgents(): Promise<AgentInfo[] | null>;
    auth(kind: AuthKind, agent: string): Promise<void>;
  };
};

export type AgentDefaults = {
  agent?: string;
  model?: string;
  effort?: string;
  access?: string;
  instructions?: string;
};

type AgentWorkspace = {
  getDefaults?(): AgentDefaults;
  getUsage?(): Record<string, number>;
};

export const settingsApi = () => window.appSettings as unknown as SettingsApi | undefined;
export const preferencesApi = () =>
  window.appPreferences as unknown as
    | { get(): Preferences; set(changes: Partial<Preferences>): void }
    | undefined;
export const agentWorkspace = () => window.agentWorkspace as unknown as AgentWorkspace | undefined;

/* ---------- Change notifications ---------- */
let version = 0;
const listeners = new Set<() => void>();
export function emit() {
  version++;
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Connect the legacy module to React: it stops rendering its own DOM and notifies us instead. */
export function attachSettings() {
  const api = settingsApi();
  if (!api?.attach) return false;
  window.addEventListener("app-preferences-changed", emit);
  api.attach({
    update: emit,
    status: (text) => {
      emit();
      if (text) toast(text);
    },
  });
  return true;
}

/** Re-renders on every settings / preferences change; returns the current state. */
export function useSettings() {
  useSyncExternalStore(subscribe, () => version);
  const api = settingsApi();
  const state = api?.getState() ?? {
    open: false,
    section: "preferences" as SectionId,
    status: "",
    accounts: {},
  };
  const preferences = preferencesApi()?.get() ?? ({} as Preferences);
  const setPreference = useCallback(
    (changes: Partial<Preferences>) => preferencesApi()?.set(changes),
    [],
  );
  return { api, state, preferences, setPreference };
}
