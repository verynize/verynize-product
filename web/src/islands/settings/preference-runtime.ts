// Behaviour behind Settings › Preferences that runs for the whole session: chat sounds (built-in synths or the
// user's MP3), desktop notifications when a chat finishes or needs the user, and verynize:// design links.
// web/settings.js forwards agent events here through window.verynizeAlerts.
import { preferencesApi, type Preferences } from "./api";
import { platform } from "@/lib/platform";

type AgentEvent = {
  type: string;
  chatId?: string;
  code?: number;
  stopped?: boolean;
  toolName?: string;
};

export type AppPreferencesApi = {
  chooseSound(): Promise<{ name: string; size: number } | null>;
  readSound(): Promise<Uint8Array | null>;
  clearSound(): Promise<boolean>;
  linksReady(options: {
    enabled: boolean;
  }): Promise<{ enabled: boolean; registered: boolean; reason?: string; pending: string[] }>;
  setLinksEnabled(
    enabled: boolean,
  ): Promise<{ enabled: boolean; registered: boolean; reason?: string }>;
  worktreeLineStats(
    roots: string[],
  ): Promise<Record<string, { added: number; removed: number; files: number } | { error: string }>>;
  onOpenLink(callback: (url: string) => void): () => void;
};

const desktop = () => platform.desktop;
export const appPreferencesApi = () => desktop()?.appPreferences;

const prefs = (): Partial<Preferences> => preferencesApi()?.get() ?? {};

/* ---------- Sounds ---------- */
export const BUILT_IN_SOUNDS = [
  "chime",
  "bell",
  "marimba",
  "crystal",
  "rise",
  "droplet",
  "pop",
] as const;

// [frequency Hz, start s, length s, peak gain, waveform]
type Note = [number, number, number, number, OscillatorType];
const SYNTHS: Record<string, Note[]> = {
  chime: [
    [880, 0, 0.5, 0.06, "sine"],
    [1318.5, 0.09, 0.6, 0.05, "sine"],
  ],
  bell: [
    [660, 0, 1.1, 0.06, "sine"],
    [1650, 0, 0.6, 0.02, "sine"],
    [2310, 0, 0.35, 0.012, "sine"],
  ],
  marimba: [
    [523.25, 0, 0.25, 0.08, "triangle"],
    [659.25, 0.11, 0.25, 0.08, "triangle"],
    [783.99, 0.22, 0.35, 0.08, "triangle"],
  ],
  crystal: [
    [1567.98, 0, 0.7, 0.035, "sine"],
    [2093, 0.06, 0.7, 0.03, "sine"],
    [3135.96, 0.12, 0.5, 0.015, "sine"],
  ],
  rise: [
    [392, 0, 0.18, 0.05, "sine"],
    [523.25, 0.1, 0.18, 0.05, "sine"],
    [659.25, 0.2, 0.18, 0.05, "sine"],
    [783.99, 0.3, 0.4, 0.05, "sine"],
  ],
  droplet: [[1200, 0, 0.18, 0.07, "sine"]],
  pop: [[440, 0, 0.3, 0.06, "sine"]],
};

function synth(kind: string) {
  const notes = SYNTHS[kind];
  if (!notes) return;
  const audio = new AudioContext();
  let end = 0;
  for (const [frequency, start, length, peak, type] of notes) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    const t = audio.currentTime + start;
    oscillator.frequency.setValueAtTime(frequency, t);
    // Droplet glides down like a water drop.
    if (kind === "droplet")
      oscillator.frequency.exponentialRampToValueAtTime(frequency / 2.4, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(t);
    oscillator.stop(t + length + 0.02);
    end = Math.max(end, start + length);
  }
  window.setTimeout(() => void audio.close(), (end + 0.2) * 1000);
}

let customUrl: string | null = null;
/** Forget the cached MP3 (after the user picks another one or removes it). */
export function resetCustomSound() {
  if (customUrl) URL.revokeObjectURL(customUrl);
  customUrl = null;
}
async function playCustom() {
  if (!customUrl) {
    const bytes = await appPreferencesApi()?.readSound();
    if (!bytes) return false;
    customUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
  }
  const audio = new Audio(customUrl);
  audio.volume = 0.7;
  await audio.play();
  return true;
}

/** Plays `kind` ("custom" = the user's MP3). Resolves false when nothing could play. */
export async function playSound(kind: string): Promise<boolean> {
  try {
    if (kind === "none") return false;
    if (kind === "custom") return await playCustom();
    synth(kind);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Agent alerts ---------- */
const NEEDS_YOU = new Set(["permission-request", "question-request"]);
function handleAgentEvent(event: AgentEvent): boolean {
  const p = prefs();
  const notify = (title: string, body: string) => {
    if (p.notifications && !document.hasFocus())
      void desktop()
        ?.notifyTask({ title, body })
        .catch(() => {});
  };
  if (event.type === "done") {
    if (event.stopped) return true;
    notify(
      "Chat finished",
      event.code === 0 ? "Your chat is ready." : "The chat ended with an error.",
    );
    if (p.sound && p.sound !== "none") void playSound(p.sound);
    return true;
  }
  if (NEEDS_YOU.has(event.type)) {
    notify(
      "Verynize needs you",
      event.type === "question-request"
        ? "A chat has a question for you."
        : "A chat is waiting for your approval.",
    );
    return true;
  }
  return false;
}

/* ---------- Design links ---------- */
function openDesignLink(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "verynize:") return;
  window.appSettings?.close?.();
  const ws = window.agentWorkspace as unknown as
    | { setCodeMode?(on: boolean): void; openLink?(url: string): boolean }
    | undefined;
  // verynize://join?invite=<https invite URL>: the share dialog joins the room (it asks before loading).
  if (parsed.host === "join") {
    const invite = parsed.searchParams.get("invite") ?? "";
    try {
      const target = new URL(invite);
      if (!["http:", "https:"].includes(target.protocol)) return;
    } catch {
      return;
    }
    ws?.setCodeMode?.(false);
    // The collab island opens the file directly (collab/links.ts); the Share dialog's Join is the fallback.
    if (window.cloudLinks?.open(invite)) return;
    const input = document.getElementById("cloud-invite") as HTMLInputElement | null;
    const dialog = document.getElementById("cloud-dialog") as HTMLDialogElement | null;
    if (!input || !dialog) return;
    input.value = invite;
    if (!dialog.open) dialog.showModal();
    document.getElementById("cloud-connect")?.click();
    return;
  }
  // verynize://node/<document>/<page>/<element>: select and zoom the element on the canvas.
  ws?.setCodeMode?.(false);
  ws?.openLink?.(url);
}

let started = false;
export function startPreferenceRuntime() {
  if (started) return;
  started = true;
  (
    window as unknown as { verynizeAlerts?: { handle(event: AgentEvent): boolean } }
  ).verynizeAlerts = { handle: handleAgentEvent };
  const api = appPreferencesApi();
  if (!api) return;
  let enabled = prefs().openLinksInApp !== false;
  api.onOpenLink(openDesignLink);
  void api
    .linksReady({ enabled })
    .then((result) => result.pending.forEach(openDesignLink))
    .catch(() => {});
  window.addEventListener("app-preferences-changed", () => {
    const next = prefs().openLinksInApp !== false;
    if (next === enabled) return;
    enabled = next;
    void api.setLinksEnabled(next).catch(() => {});
  });
}
