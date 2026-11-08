// Opening a file link (`<server>/#room=<id>[&token=<capability>]`) opens that file in the editor, in every browser and
// in the desktop app (verynize://join?invite=<link>): no Files home, no Share dialog, no confirm().
//
// - The token leaves the address bar before anything loads (history entries keep `#room=<id>` only). It is kept in
//   sessionStorage until the room has opened, so "Sign in with another account" can still use it after the reload.
// - Signed out on the web, the editor layout (web-start/src/legacy/web-auth.ts) shows the sign-in wall for private
//   rooms and boots the editor for public ones, which open here anonymously and read-only.
// - Without access: the invitation (when the server reports one for this account: a 401/403 carrying
//   `{invitation: {id, organizationName, inviterName, role}}`) or the "You don’t have access" screen.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { platform } from "@/lib/platform";

export type RoomLink = { server: string; id: string; token: string | null };
export type Invitation = {
  id: string;
  organizationName?: string;
  inviterName?: string;
  role?: string;
};
export type LinkScreen =
  | { kind: "none" }
  | { kind: "no-access"; link: RoomLink; signedIn: boolean }
  | { kind: "invitation"; link: RoomLink; invitation: Invitation };

type Workspace = {
  openRoom(info: {
    server: string;
    id: string;
    token?: string | null;
    anonymous?: boolean;
  }): Promise<void>;
  hasSession?(server: string): boolean;
  room?(): { server: string; id: string } | null;
};
type RoomError = Error & { status?: number; data?: { invitation?: Invitation } | null };
const workspace = () => (window as unknown as { cloudWorkspace?: Workspace }).cloudWorkspace;
const library = () =>
  window.fileLibrary as
    | (typeof window.fileLibrary & { showEditor?(): void; showHome?(): void })
    | undefined;

const ROOM_ID = /^[0-9a-f-]{36}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const PENDING_KEY = "verynize.pendingLink";

/** A room link (`#room=<uuid>[&token=<64 hex>]` on an http(s) origin), or null. */
export function parseRoomLink(href: string): RoomLink | null {
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    const id = params.get("room") ?? "";
    const token = params.get("token");
    if (!ROOM_ID.test(id) || (token && !TOKEN.test(token))) return null;
    return { server: url.origin, id, token: token || null };
  } catch {
    return null;
  }
}

/* ---------- Screen state (no-access / invitation) ---------- */

let screen: LinkScreen = { kind: "none" };
const listeners = new Set<() => void>();
function show(next: LinkScreen) {
  screen = next;
  for (const listener of listeners) listener();
}
export function useLinkScreen(): LinkScreen {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => screen,
  );
}

/* ---------- Token handling ---------- */

function stashToken(link: RoomLink) {
  try {
    if (link.token)
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: link.id, token: link.token }));
  } catch {}
}
function stashedToken(id: string): string | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null") as {
      id?: string;
      token?: string;
    } | null;
    return stored?.id === id && stored.token && TOKEN.test(stored.token) ? stored.token : null;
  } catch {
    return null;
  }
}
function forgetToken() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {}
}

/** Replace the current entry's `#room=<id>&token=…` with `#room=<id>` (through the router's history when it has one). */
function stripAddressToken(id: string) {
  if (!new URLSearchParams(location.hash.slice(1)).has("token")) return;
  const next = `${location.pathname}${location.search}#room=${id}`;
  const history = (
    window as unknown as {
      shellRouter?: {
        history?: { replace(path: string, state?: unknown): void; location?: { state?: unknown } };
      };
    }
  ).shellRouter?.history;
  if (history?.replace) history.replace(next, history.location?.state);
  else window.history.replaceState(window.history.state, "", next);
}

/* ---------- Opening ---------- */

let opening: Promise<void> | null = null;

/** Open a room link as a file in the editor. `fromAddress`: the link is this page's own address (web). */
export function openRoomLink(link: RoomLink, { fromAddress = false } = {}): Promise<void> {
  const run = async () => {
    const cw = workspace();
    if (!cw) return;
    const token = link.token || stashedToken(link.id);
    const full = { ...link, token };
    if (token) stashToken(full);
    if (fromAddress) stripAddressToken(link.id);
    const signedIn = !!cw.hasSession?.(link.server);
    show({ kind: "none" });
    try {
      const open = cw.room?.();
      if (!(open && open.id === link.id && open.server === link.server))
        await cw.openRoom({
          server: link.server,
          id: link.id,
          token,
          anonymous: !token && !signedIn,
        });
      forgetToken();
      // A superseded or canceled open (another file, or back to Files) resolves without the room: stay put.
      const now = cw.room?.();
      if (now && now.id === link.id && now.server === link.server) library()?.showEditor?.();
    } catch (e) {
      const error = e as RoomError;
      const denied =
        [401, 403, 404].includes(error.status ?? 0) ||
        error.message.startsWith("Sign in to open a room");
      if (!denied) {
        toast(error.message || "This file could not be opened");
        return;
      }
      const invitation = error.data?.invitation;
      if (signedIn && invitation?.id) show({ kind: "invitation", link: full, invitation });
      else show({ kind: "no-access", link: full, signedIn });
    }
  };
  const previous = opening ?? Promise.resolve();
  const next = previous.then(run, run);
  opening = next;
  return next;
}

/** Leave a link that cannot open: the Files home, without its fragment. */
export function backToFiles(link: RoomLink) {
  forgetToken();
  show({ kind: "none" });
  window.shellNavigation?.clearRoomHash?.(link.id);
  library()?.showHome?.();
}

/**
 * Sign out and sign in as someone else, then open the link again. On the web signing out reloads the page into the
 * sign-in wall (web-start/src/legacy/web-auth.ts watchSignOut), which keeps the `#room=` fragment; the token waits in
 * sessionStorage. On the desktop the onboarding's account step opens and the link retries once signed in.
 */
export async function signInAgain(link: RoomLink, signedIn: boolean) {
  stashToken(link);
  show({ kind: "none" });
  const account = (
    window as unknown as {
      cloudAccount?: { signOut(everywhere?: boolean): Promise<void>; get(): unknown };
    }
  ).cloudAccount;
  if (signedIn) await account?.signOut(false).catch(() => {});
  if (platform.kind === "web") return;
  const retry = () => {
    if (!account?.get()) return;
    window.removeEventListener("cloud-account-changed", retry);
    void openRoomLink(link);
  };
  window.addEventListener("cloud-account-changed", retry);
  const { openSignIn } = await import("@/lib/cloud-account");
  openSignIn();
}

declare global {
  interface Window {
    cloudLinks?: { open(href: string): boolean };
  }
}

/**
 * Installs `window.cloudLinks` (desktop deep links) and opens this page's own `#room=` link once. Both wait for
 * `ready`: a cold-start deep link can arrive before the shell boots, and the boot would replace the opened room.
 */
export function installLinks(ready: Promise<void>) {
  window.cloudLinks = {
    open(href: string) {
      const link = parseRoomLink(href);
      if (!link) return false;
      void ready.then(() => openRoomLink(link));
      return true;
    },
  };
  const own = parseRoomLink(location.href);
  if (own) void ready.then(() => openRoomLink(own, { fromAddress: true }));
}
