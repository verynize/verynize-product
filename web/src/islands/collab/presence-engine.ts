// Presence for shared rooms: who is here, their cursors and selections, and this device's Multiplayer tools
// (Hide cursors, Appear busy, Go invisible). web/cloud-panel.js owns the socket and calls in here:
// `cloudPresence.sync(state)` whenever the room, the role, the peer list or the local document changes, and
// `cloudPresence.message(base)` to shape each outgoing presence message (null sends nothing).
//
// The canvas stays imperative: cursors and remote selection outlines are plain DOM in `#cloud-cursors`, a layer
// inside `#canvas` in world coordinates (the camera transform moves them; `--iz` keeps labels at screen size).
// React reads `snapshot()` through `usePresence()` and never subscribes to pointer movement.
//
// Wire format. The room server relays `{name, pageId, cursor}` per socket (cloud/rooms.js). Busy, invisible and the
// selection travel after the page id: `<pageId>\u001e<flag>;<flag>…` with flags `b` (busy), `i` (invisible) and
// `s=<id>,<id>` (selected layers, trimmed to the server's 120 characters). A plain page id means none of them, so an
// idle client stays readable by older clients. Fields a newer server sends itself (`busy`, `avatarUrl`, `selection`,
// `invisible`) win over the encoded ones.
import { useSyncExternalStore } from "react";
import type { DesignApi } from "@/lib/bridge";

type Point = { x: number; y: number };
type RawPeer = {
  id: string;
  name?: string | null;
  role?: string | null;
  pageId?: string | null;
  cursor?: Point | null;
  handle?: string | null;
  avatarUrl?: string | null;
  busy?: boolean;
  invisible?: boolean;
  selection?: string[];
};
export type RoomState = {
  connected: boolean;
  server: string | null;
  roomId: string | null;
  fileId: string | null;
  role: string | null;
  selfId: string | null;
  peers: RawPeer[];
};
export type Person = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** 1–8: `--peer-N` / `bg-peer-N`. */
  colorIndex: number;
  /** CSS colour (`var(--peer-N)`), as in the `verynize:cloud-state` contract. */
  color: string;
  self: boolean;
  busy: boolean;
  pageId: string | null;
  cursor: Point | null;
  selection: string[];
};
export type PresencePrefs = { hideCursors: boolean; busy: boolean; invisible: boolean };
export type PresenceSnapshot = {
  connected: boolean;
  roomId: string | null;
  role: string | null;
  readOnly: boolean;
  visibility: string | null;
  /** This device's entry (also when not in a room). */
  self: Person;
  /** Everyone visible in the room, this device first. */
  people: Person[];
  prefs: PresencePrefs;
  following: string | null;
};

type Workspace = {
  sendPresence?(): void;
  presence?(): RoomState;
  request?<T>(path: string, options?: RequestInit): Promise<T>;
  shareLink?(): string;
};
type Account = {
  account: { handle: string; displayName: string; email: string; avatarUrl: string };
};
type CanvasApi = DesignApi & {
  getView?(): { page?: string };
  screenToWorld(x: number, y: number): { x: number; y: number };
};
/** window.design with the camera helpers app.js exposes (web/app.js window.verynize). */
const canvas = () => window.design as CanvasApi | undefined;
const workspace = () => (window as unknown as { cloudWorkspace?: Workspace }).cloudWorkspace;
const account = () =>
  (window as unknown as { cloudAccount?: { get(): Account | null } }).cloudAccount?.get() ?? null;

const SEP = "\u001e";
const PAGE_LIMIT = 120;
const PREFS_KEY = "verynize.presence";
export const PRESENCE_EVENT = "cloud-presence-changed";

function loadPrefs(): PresencePrefs {
  try {
    const stored = JSON.parse(
      localStorage.getItem(PREFS_KEY) || "null",
    ) as Partial<PresencePrefs> | null;
    return {
      hideCursors: !!stored?.hideCursors,
      busy: !!stored?.busy,
      invisible: !!stored?.invisible,
    };
  } catch {
    return { hideCursors: false, busy: false, invisible: false };
  }
}

/** Stable colour slot for a person: the account handle when there is one, else the name or socket id. */
export function colorSlot(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 8) + 1;
}

function decode(pageId: string | null | undefined) {
  const [page = "", meta = ""] = String(pageId ?? "").split(SEP);
  const flags = meta ? meta.split(";") : [];
  const selection = flags.find((flag) => flag.startsWith("s="))?.slice(2) ?? "";
  return {
    page: page || null,
    busy: flags.includes("b"),
    invisible: flags.includes("i"),
    selection: selection ? selection.split(",").filter(Boolean) : [],
  };
}

function encode(page: string, busy: boolean, selection: string[]) {
  const flags = busy ? ["b"] : [];
  if (!flags.length && !selection.length) return page;
  let ids = [...selection];
  const build = () =>
    page + SEP + [...flags, ...(ids.length ? [`s=${ids.join(",")}`] : [])].join(";");
  while (ids.length && build().length > PAGE_LIMIT) ids = ids.slice(0, -1);
  return build();
}

const INVISIBLE_PAGE = SEP + "i";

/** The name this device shows to others: the account's display name, else its email, else the Share panel name. */
function ownName(fallback?: string) {
  const profile = account()?.account;
  if (profile) return profile.displayName?.trim() || profile.email;
  const prefs = (window.appPreferences?.get?.() ?? {}) as { displayName?: string; name?: string };
  return String(fallback || prefs.displayName || prefs.name || "You").trim();
}

const EMPTY_ROOM: RoomState = {
  connected: false,
  server: null,
  roomId: null,
  fileId: null,
  role: null,
  selfId: null,
  peers: [],
};

let room: RoomState = EMPTY_ROOM;
let prefs = loadPrefs();
let following: string | null = null;
let visibility: string | null = null;
let visibilityRoom: string | null = null;
let people: Person[] = [];
let current: PresenceSnapshot | null = null;
let signature = "";
const listeners = new Set<() => void>();

const activePage = () => canvas()?.getView?.().page ?? null;
const selectionIds = () => canvas()?.getSelection?.() ?? [];

function selfPerson(raw?: RawPeer): Person {
  const profile = account()?.account;
  const index = colorSlot(profile?.handle || raw?.handle || raw?.name || "self");
  return {
    id: raw?.id ?? "self",
    name: ownName(raw?.name ?? undefined),
    avatarUrl: profile?.avatarUrl || raw?.avatarUrl || null,
    colorIndex: index,
    color: `var(--peer-${index})`,
    self: true,
    busy: prefs.busy,
    pageId: activePage(),
    cursor: null,
    selection: [],
  };
}

function toPerson(raw: RawPeer): Person | null {
  const meta = decode(raw.pageId);
  if (raw.invisible || meta.invisible || raw.name === "") return null;
  const index = colorSlot(raw.handle || raw.name || raw.id);
  return {
    id: raw.id,
    name: raw.name || "Guest",
    avatarUrl: raw.avatarUrl || null,
    colorIndex: index,
    color: `var(--peer-${index})`,
    self: false,
    busy: raw.busy ?? meta.busy,
    pageId: meta.page,
    cursor: raw.cursor ?? null,
    selection: raw.selection ?? meta.selection,
  };
}

function computePeople() {
  const selfRaw = room.connected ? room.peers.find((peer) => peer.id === room.selfId) : undefined;
  const others = room.connected
    ? room.peers
        .filter((peer) => peer.id !== room.selfId)
        .map(toPerson)
        .filter((p): p is Person => !!p)
    : [];
  return [selfPerson(selfRaw), ...others];
}

function snapshotOf(): PresenceSnapshot {
  return {
    connected: room.connected,
    roomId: room.roomId,
    role: room.role,
    readOnly: room.connected && !!room.role && room.role !== "owner" && room.role !== "editor",
    visibility,
    self: people[0] ?? selfPerson(),
    people,
    prefs: { ...prefs },
    following,
  };
}

function publish(force = false) {
  people = computePeople();
  const next = snapshotOf();
  // Cursor positions change constantly; the UI only re-renders for who is here and how they show.
  const key = JSON.stringify({
    ...next,
    people: next.people.map(
      ({ cursor: _cursor, selection: _selection, pageId: _page, ...person }) => person,
    ),
  });
  if (!force && key === signature && current) return;
  signature = key;
  current = next;
  for (const listener of listeners) listener();
  window.dispatchEvent(new CustomEvent(PRESENCE_EVENT, { detail: next }));
  // CONTRACT §2: the Share workstream emits `verynize:cloud-state` from web/cloud-panel.js once it adds
  // cloudWorkspace.shareLink(); until then this module does, with the same detail.
  if (typeof workspace()?.shareLink !== "function")
    window.dispatchEvent(
      new CustomEvent("verynize:cloud-state", {
        detail: {
          connected: next.connected,
          roomId: next.roomId,
          role: next.role,
          visibility: next.visibility,
          peers: next.connected
            ? next.people.map(({ id, name, avatarUrl, color, self, busy }) => ({
                id,
                name,
                avatarUrl,
                color,
                self,
                busy,
              }))
            : [],
        },
      }),
    );
}

function loadVisibility() {
  if (room.roomId === visibilityRoom) return;
  visibilityRoom = room.roomId;
  visibility = null;
  const id = room.roomId;
  if (!id) return;
  workspace()
    ?.request?.<{ visibility?: string }>(`/api/rooms/${id}/access`)
    .then((access) => {
      if (room.roomId !== id) return;
      visibility = access?.visibility ?? null;
      publish();
    })
    .catch(() => {});
}

/* ---------- Outgoing presence ---------- */

let sendTimer = 0;
function resend() {
  if (sendTimer) return;
  sendTimer = window.setTimeout(() => {
    sendTimer = 0;
    workspace()?.sendPresence?.();
  }, 120);
}

/** What the server holds for this socket differs from what this device wants to show: send again. */
function reconcile() {
  if (!room.connected || !room.selfId) return;
  const self = room.peers.find((peer) => peer.id === room.selfId);
  if (!self) return;
  const meta = decode(self.pageId);
  if (prefs.invisible) {
    if (!meta.invisible) resend();
    return;
  }
  const page = activePage();
  if (
    meta.invisible ||
    (page && self.pageId !== encode(page, prefs.busy, selectionIds())) ||
    self.name !== ownName(self.name ?? undefined)
  )
    resend();
}

type PresenceMessage = { type: "presence"; name: string; cursor: Point | null; pageId: string };
function message(base: PresenceMessage): PresenceMessage | null {
  if (prefs.invisible) {
    // One marker per socket: others drop this entry from their lists and draw no cursor.
    const self = room.peers.find((peer) => peer.id === room.selfId);
    if (self && decode(self.pageId).invisible) return null;
    return { type: "presence", name: "", cursor: null, pageId: INVISIBLE_PAGE };
  }
  return {
    ...base,
    name: ownName(base.name),
    pageId: encode(base.pageId, prefs.busy, selectionIds()),
  };
}

/* ---------- Canvas overlay ---------- */

const CURSOR_SVG =
  '<svg class="collaborator-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 1.5 13 7.2 8.2 8.6 6.1 13.4z"/></svg>';

function draw() {
  document.getElementById("cloud-cursors")?.remove();
  const host = document.getElementById("canvas");
  const api = canvas();
  if (!host || !api || !room.connected || prefs.hideCursors) return;
  const overlay = document.createElement("div");
  overlay.id = "cloud-cursors";
  overlay.setAttribute("aria-hidden", "true");
  const page = activePage();
  for (const person of people) {
    if (person.self || (person.pageId && page && person.pageId !== page)) continue;
    for (const id of person.selection) {
      const el = host.querySelector(`.layer[data-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const a = api.screenToWorld(r.left, r.top);
      const b = api.screenToWorld(r.right, r.bottom);
      const outline = document.createElement("div");
      outline.className = "collaborator-selection";
      outline.dataset.peer = person.id;
      outline.dataset.node = id;
      Object.assign(outline.style, {
        left: `${a.x}px`,
        top: `${a.y}px`,
        width: `${b.x - a.x}px`,
        height: `${b.y - a.y}px`,
      });
      outline.style.setProperty("--peer", person.color);
      overlay.append(outline);
    }
    if (!person.cursor) continue;
    const marker = document.createElement("div");
    marker.className = "collaborator-cursor";
    marker.dataset.peer = person.id;
    if (person.busy) marker.dataset.busy = "true";
    marker.style.left = `${person.cursor.x}px`;
    marker.style.top = `${person.cursor.y}px`;
    marker.style.setProperty("--peer", person.color);
    marker.innerHTML = CURSOR_SVG;
    const label = document.createElement("span");
    label.className = "collaborator-label";
    label.textContent = person.name;
    marker.append(label);
    overlay.append(marker);
  }
  host.append(overlay);
}

/* ---------- Follow ---------- */

function centerOn(point: Point) {
  const area = document.getElementById("workspace")?.getBoundingClientRect();
  const api = canvas();
  if (!area || !api) return;
  const middle = api.screenToWorld(area.left + area.width / 2, area.top + area.height / 2);
  const cam = api.getCamera();
  api.setCamera(
    cam.x + (middle.x - point.x) * cam.zoom,
    cam.y + (middle.y - point.y) * cam.zoom,
    cam.zoom,
  );
}

let lastFollowed = "";
function followStep() {
  if (!following) return;
  const person = people.find((p) => p.id === following);
  if (!person || !room.connected) {
    stopFollowing();
    return;
  }
  const api = canvas();
  if (!api) return;
  if (person.pageId && person.pageId !== activePage()) api.setActivePage(person.pageId);
  let target = person.cursor;
  if (!target && person.selection.length) {
    const el = document.querySelector(
      `#canvas .layer[data-id="${CSS.escape(person.selection[0])}"]`,
    );
    if (el) {
      const r = el.getBoundingClientRect();
      target = api.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
  }
  const key = target ? `${person.pageId}|${Math.round(target.x)}|${Math.round(target.y)}` : "";
  if (target && key !== lastFollowed) {
    lastFollowed = key;
    centerOn(target);
  }
}

function stopFollowing() {
  if (!following) return;
  following = null;
  lastFollowed = "";
  publish();
}

// Any canvas gesture of this user ends following, as in Wonder.
for (const type of ["wheel", "pointerdown"] as const)
  document.addEventListener(
    type,
    (event) => {
      if (following && (event.target as Element | null)?.closest?.("#workspace") && event.isTrusted)
        stopFollowing();
    },
    { capture: true, passive: true },
  );
document.addEventListener("keydown", (event) => {
  if (following && event.key === "Escape") stopFollowing();
});

/* ---------- Public API ---------- */

function sync(next: RoomState) {
  const left = room.connected && (!next.connected || next.roomId !== room.roomId);
  room = next.connected ? next : EMPTY_ROOM;
  if (left) following = null;
  loadVisibility();
  publish();
  draw();
  followStep();
  reconcile();
}

function setPrefs(patch: Partial<PresencePrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
  workspace()?.sendPresence?.();
  publish();
  draw();
}

function follow(id: string | null) {
  following = id;
  lastFollowed = "";
  publish();
  followStep();
}

export const presence = {
  sync,
  message,
  snapshot: (): PresenceSnapshot => {
    if (!current) publish(true);
    return current ?? snapshotOf();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setPrefs,
  follow,
};

declare global {
  interface Window {
    cloudPresence?: typeof presence;
  }
}

/** Installs the engine (once) and picks up a room that connected before the islands loaded. */
export function installPresence() {
  if (window.cloudPresence) return;
  window.cloudPresence = presence;
  const state = workspace()?.presence?.();
  if (state) sync(state);
  else publish(true);
  // The account name and avatar show in the list; a new name goes to the room too.
  window.addEventListener("cloud-account-changed", () => {
    publish();
    workspace()?.sendPresence?.();
  });
  window.addEventListener("app-preferences-changed", () => publish());
}

export function usePresence(): PresenceSnapshot {
  return useSyncExternalStore(presence.subscribe, presence.snapshot);
}
