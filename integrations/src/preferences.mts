// Design preferences: short, durable rules the user wants agents to apply to every design
// ("use 8px corner radius", "never use purple gradients"). Stored as one small JSON file shared by
// the desktop app (Settings › Memory, agent persona) and the MCP tools (save/list/update/delete).
//
//   defaultPreferencesPath() -> $VERYNIZE_PREFERENCES, else
//                               ~/Library/Application Support/Verynize/design-preferences.json
//   createPreferenceStore(file) -> {list, save, update, remove}
//     list()            -> Promise<[{id, text, created, updated}]>   oldest first
//     save(text)        -> Promise<{...pref, duplicate}>            dedupes case/whitespace-insensitively
//     update(id, text)  -> Promise<pref>
//     remove(id)        -> Promise<{deleted: true, id}>
//
// Limits: at most MAX_PREFERENCES (50) preferences of at most MAX_PREFERENCE_LENGTH (280) characters
// each. These two constants are the single source of truth: the desktop persona block and the IPC
// validator (desktop/agent-runtime.cjs) load them from here. Writes are atomic (temp file + rename,
// mode 0600) and serialized per file within the process.
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";

export interface Preference {
  id: string;
  text: string;
  created: string | null;
  updated: string | null;
}
interface StoredPreference extends Record<string, unknown> {
  id: string;
  text: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const timestamp = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

export const MAX_PREFERENCES = 50;
export const MAX_PREFERENCE_LENGTH = 280;

export function defaultPreferencesPath(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERYNIZE_PREFERENCES) return path.resolve(env.VERYNIZE_PREFERENCES);
  const home = os.homedir();
  const base =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? env.APPDATA || path.join(home, "AppData", "Roaming")
        : env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "Verynize", "design-preferences.json");
}

const normalize = (text: unknown) => String(text).trim().replace(/\s+/g, " ");
const key = (text: string) => normalize(text).toLowerCase();
const newId = () => "pref_" + randomBytes(5).toString("hex");

function cleanText(text: unknown) {
  if (typeof text !== "string") throw new Error("Preference text must be a string");
  const value = normalize(text);
  if (!value) throw new Error("Preference text is empty");
  if (value.length > MAX_PREFERENCE_LENGTH)
    throw new Error(
      `Preference text is longer than ${MAX_PREFERENCE_LENGTH} characters; keep it to one short rule`,
    );
  return value;
}
const validEntry = (p: unknown): p is StoredPreference =>
  record(p) &&
  typeof p.id === "string" &&
  /^[\w-]{1,64}$/.test(p.id) &&
  typeof p.text === "string" &&
  !!p.text.trim();

const queues = new Map<string, Promise<unknown>>(); // file -> tail promise (serializes read-modify-write per file)

export function createPreferenceStore(filePath = defaultPreferencesPath()) {
  const file = path.resolve(filePath);
  async function read(): Promise<Preference[]> {
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if (record(error) && error.code === "ENOENT") return [];
      throw error;
    }
    if (!raw.trim()) return [];
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Design preferences file is not valid JSON: ${file}`);
    }
    const list = Array.isArray(data) ? data : record(data) ? data.preferences : undefined;
    if (!Array.isArray(list)) return [];
    return (list as unknown[])
      .filter(validEntry)
      .slice(0, MAX_PREFERENCES)
      .map((p) => ({
        id: p.id,
        text: String(p.text).slice(0, MAX_PREFERENCE_LENGTH),
        created: timestamp(p.created),
        updated: timestamp(p.updated) || timestamp(p.created),
      }));
  }
  async function write(list: Preference[]) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify({ version: 1, preferences: list }, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(temp, file);
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      throw error;
    }
  }
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(file) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(file, tail);
    void tail.then(() => {
      if (queues.get(file) === tail) queues.delete(file);
    });
    return run;
  }
  const find = (list: Preference[], id: string) => {
    const at = list.findIndex((p) => p.id === id);
    if (at < 0) throw new Error(`No design preference with id ${id}; call list_design_preferences`);
    return at;
  };

  return {
    file,
    list: () => serialized(read),
    save: (text: unknown) =>
      serialized(async () => {
        const value = cleanText(text);
        const list = await read();
        const existing = list.find((p) => key(p.text) === key(value));
        if (existing) return { ...existing, duplicate: true };
        if (list.length >= MAX_PREFERENCES)
          throw new Error(
            `At most ${MAX_PREFERENCES} design preferences can be saved; update or delete one first`,
          );
        const now = new Date().toISOString();
        const pref = { id: newId(), text: value, created: now, updated: now };
        list.push(pref);
        await write(list);
        return { ...pref, duplicate: false };
      }),
    update: (id: string, text: unknown) =>
      serialized(async () => {
        const value = cleanText(text);
        const list = await read();
        const at = find(list, id);
        const clash = list.find((p) => p.id !== id && key(p.text) === key(value));
        if (clash) throw new Error(`The same preference is already saved as ${clash.id}`);
        list[at] = { ...list[at], text: value, updated: new Date().toISOString() };
        await write(list);
        return list[at];
      }),
    remove: (id: string) =>
      serialized(async () => {
        const list = await read();
        const at = find(list, id);
        list.splice(at, 1);
        await write(list);
        return { deleted: true, id };
      }),
  };
}
