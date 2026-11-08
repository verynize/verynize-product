// Cloud files in the Files home: rooms of the active workspace (`/api/orgs/:id/rooms`) plus rooms
// shared with the account directly (`/api/me/rooms`), merged with this device's cloud-backed
// library records so each room appears once. Opening a listed room joins it through
// the library, which selects the destination route before fetching its document.
import "@/lib/account-store";
import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActiveOrganization, useCloudAccount, useOrganizations } from "@/lib/cloud-account";
import {
  accountScope,
  queryKeys,
  scopedRequest,
  SIGNED_OUT,
  type AccountScope,
} from "@/lib/query/keys";
import type { DesignDocument } from "@/lib/bridge";
import { library, type CloudRoom, type LibraryFile } from "./library";

type RoomRow = {
  id: string;
  title?: string;
  role?: string;
  updatedAt?: number;
  organizationId?: string | null;
  organizationName?: string | null;
};

const RANK: Record<string, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const higher = (a = "", b = "") => ((RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b);

type RoomLists = { workspace: { role: string; rooms: RoomRow[] }; mine: { rooms: RoomRow[] } };
/** Rooms of a workspace (none when `organizationId` is null) and rooms shared with the account. */
export const cloudRoomsQuery = (scope: AccountScope, organizationId: string | null) =>
  queryOptions({
    queryKey: queryKeys.rooms(scope, organizationId),
    queryFn: async (): Promise<RoomLists> => {
      const [workspace, mine] = await Promise.all([
        organizationId
          ? scopedRequest<RoomLists["workspace"]>(scope, `/api/orgs/${organizationId}/rooms`)
          : { role: "", rooms: [] as RoomRow[] },
        scopedRequest<RoomLists["mine"]>(scope, "/api/me/rooms"),
      ]);
      return { workspace, mine };
    },
  });

function mergeRooms(
  { workspace, mine }: RoomLists,
  server: string,
  organizationName: string | null,
): CloudRoom[] {
  const byId = new Map<string, CloudRoom>();
  const roleIn = new Map(mine.rooms.map((room) => [room.id, room.role ?? ""]));
  for (const room of workspace.rooms)
    byId.set(room.id, {
      id: room.id,
      server,
      title: room.title || "Untitled",
      role: higher(workspace.role, roleIn.get(room.id)),
      updatedAt: room.updatedAt ?? 0,
      organizationName: organizationName ?? "Workspace",
    });
  // Direct shares: rooms outside any of your organizations.
  for (const room of mine.rooms)
    if (!room.organizationId && !byId.has(room.id))
      byId.set(room.id, {
        id: room.id,
        server,
        title: room.title || "Untitled",
        role: room.role ?? "viewer",
        updatedAt: room.updatedAt ?? 0,
        organizationName: null,
      });
  return [...byId.values()];
}

const NO_ROOMS: CloudRoom[] = [];
/** Rooms of the active workspace and rooms shared with you; empty when signed out. */
export function useCloudRooms(active: boolean) {
  const scope = accountScope(useCloudAccount());
  const organization = useActiveOrganization();
  const { organizations } = useOrganizations();
  const organizationName = organizations.find((org) => org.id === organization)?.name ?? null;
  const enabled = active && !!scope;
  const query = useQuery({
    ...cloudRoomsQuery(scope ?? SIGNED_OUT, organization),
    enabled,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });
  const { data, error } = query;
  const server = scope?.server ?? "";
  // Like before: no rooms while signed out, hidden, or after a failed load.
  const rooms = useMemo(
    () => (enabled && data && !error ? mergeRooms(data, server, organizationName) : NO_ROOMS),
    [enabled, data, error, server, organizationName],
  );
  return { rooms, error: enabled && error ? error.message : "" };
}

const emptyDocument = (name: string): DesignDocument =>
  ({ version: 2, name, activePage: "", pages: [], tokens: {} }) as unknown as DesignDocument;

/** Library files with their room's role, plus listed rooms that have no file here yet. */
export function mergeCloudFiles(files: LibraryFile[], rooms: CloudRoom[]): LibraryFile[] {
  const byKey = new Map(rooms.map((room) => [`${room.server}|${room.id}`, room]));
  const merged = files.map((file) => {
    const room = file.cloud && byKey.get(`${file.cloud.server}|${file.cloud.roomId}`);
    if (!room) return file;
    byKey.delete(`${room.server}|${room.id}`);
    return {
      ...file,
      name: room.title,
      updated: room.updatedAt,
      cloud: { ...file.cloud!, role: room.role },
      room,
    };
  });
  for (const room of byKey.values())
    merged.push({
      id: `room:${room.id}`,
      name: room.title,
      document: emptyDocument(room.title),
      updated: room.updatedAt,
      folder: null,
      archived: false,
      cloud: { server: room.server, roomId: room.id, role: room.role },
      room,
    });
  const metadata = Object.fromEntries(window.accountStore?.entries("file:") ?? []);
  return merged.map((file) => {
    const meta = file.cloud && metadata[file.cloud.roomId];
    return meta ? { ...file, folder: meta.folder ?? null, archived: !!meta.archived } : file;
  });
}

/** True for a listed room that has no library record on this device. */
export const isRemoteRoom = (file: LibraryFile) => !!file.room && file.id.startsWith("room:");

/** Open a file, or join a listed room (its file is created on first open). */
export function openEntry(file: LibraryFile, open: (id: string) => unknown) {
  if (!isRemoteRoom(file))
    return void Promise.resolve(open(file.id)).catch((e: unknown) =>
      toast(e instanceof Error ? e.message : String(e)),
    );
  void library()
    .openRoomFile(file.room!)
    .catch((e: unknown) => {
      // A failed open from Files announces itself (chrome/SwitchLoading.tsx); only earlier errors are shown here.
      if (!(e as { notified?: boolean } | null)?.notified)
        toast(e instanceof Error ? e.message : String(e));
    });
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};
