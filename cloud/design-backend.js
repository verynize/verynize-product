// The design tools of integrations/design-tools.mjs over the shared cloud rooms of one signed-in
// account: the backend interface (list/read/transact/create/open/focus) implemented against the
// DesignRoom actors, the hosted tool set (unavailable tools removed, cloud overrides added) and one
// call path for a tool. Shared by the hosted MCP endpoint (cloud/mcp.js) and the model API runtime
// (cloud/ai.js), so both run the same tools with the same authorization.
//
// The account always comes from the router's session (accountOf), never from a request body or a
// model. Room access is checked by the room itself (agentRead/agentApply/agentRole) on every call.
import "#mcp-env";
import "../web/cloud-ops.js";
import { z } from "zod";
import { INSTRUCTIONS, revisionOf, sessionFor, toolTable } from "../integrations/design-tools.mjs";
import { SHELL_TOOL_NAMES } from "../integrations/shell-tools.mjs";
import { validateDocument } from "../integrations/design-store.mjs";
import { fetchImageAsDataUrl } from "../integrations/images.mjs";
import { provideIconSets } from "../integrations/assets.mjs";
import { loadIconSets } from "#mcp-env";
import { roleRank, atLeast, rpc } from "./http.js";
import {
  addRoom,
  ensurePersonalOrganization,
  membership,
  orgRoomRole,
  syncTitle,
  userOrganizationRooms,
} from "./orgs.js";
import { createAuth } from "./auth.js";
import * as profiles from "./profiles.js";
import { extractInline } from "./inline-binaries.js";

const Ops = globalThis.VerynizeOps;
const MAX_IMAGE = 512 * 1024; // conservative inline image budget; larger images should use room assets
const ASSET_WAIT_MS = 25_000;
export const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Tools that cannot run on the hosted server, with the reason a caller gets if it calls one anyway. */
export const UNAVAILABLE = {
  upload_asset: "upload_asset reads a permitted local file and requires the desktop/stdio backend. Use the authenticated room binary upload API on the hosted server.",
  import_pen: "import_pen requires a local unencrypted JSON file; use the desktop/stdio backend.",
  preflight_import: "preflight_import inspects local files; use the desktop/stdio backend.",
  take_screenshot:
    'take_screenshot is unavailable on the hosted (headless) server: there is no renderer. Inspect elements with get_element_code or get_element_tree; finish_artboard reports "unverified" without a screenshot. Open the room in the Verynize desktop app to render it.',
  ask_agent:
    "ask_agent is unavailable on the hosted server: it runs the other agent inside the Verynize desktop app.",
  import_html:
    "import_html is unavailable on the hosted server (it reads local files and remote pages). Convert the page to JSX and use import_jsx or create_artboard.",
  save_design_preference:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  list_design_preferences:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  update_design_preference:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  delete_design_preference:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  export_document:
    "export_document is unavailable on the hosted server; use export_css (lossless HTML + CSS) or export_jsx.",
};
for (const name of SHELL_TOOL_NAMES)
  UNAVAILABLE[name] =
    `${name} needs the Verynize desktop app (running app, terminal and editor actions); it is unavailable on the hosted server.`;
const ICON_TOOLS = new Set(["get_icons", "create_artboard", "update_elements", "import_jsx"]);

const roomArg = z
  .string()
  .regex(ROOM_ID, "Use a room id (a UUID) from list_documents")
  .optional()
  .describe("Room id from list_documents. Omit when the account reaches exactly one room.");

/** Cloud variants of the document tools: rooms instead of files, and no desktop editor to open. */
export const OVERRIDES = {
  list_documents: {
    description:
      'List the shared cloud rooms this account reaches (its own, shared with it, and its organizations\' rooms) with title, role and editor URL. Pass a room id as "document" to the other tools.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    run: (backend) => backend.list(),
  },
  open_document: {
    description:
      "Hosted server: returns the editor URL of a room (<origin>/#room=<id>) to give the user. Nothing is opened; editors already showing the room receive edits live.",
    inputSchema: { name: roomArg },
    annotations: { readOnlyHint: true },
    run: (backend, { name }) => backend.open({ name }),
  },
  create_document: {
    description:
      'Create a new shared cloud room holding an empty document titled `title`, owned by you, in your personal organization or the organization named by organizationId (you must be a member). Returns its room id (pass it as "document") and editor URL. `name` is accepted for compatibility and ignored: rooms are addressed by id.',
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      name: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/)
        .optional()
        .describe("Ignored on the hosted server"),
      organizationId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/)
        .optional()
        .describe("Organization to create the room in; defaults to your personal organization"),
      open: z.boolean().optional().describe("Ignored on the hosted server"),
    },
    run: (backend, { name, title, organizationId }) =>
      backend.create(name, title, { organizationId }),
  },
};

export const HOSTED_INSTRUCTIONS = `${INSTRUCTIONS.split("## Live editing")[0].trimEnd()}

## Hosted server (headless)
This is the hosted Verynize MCP server. Documents are the shared cloud rooms of the signed-in account: list_documents lists them and every tool takes a room id as "document" (or "name" on the low-level tools). Edits are applied to the room immediately and appear live in every editor that has the room open; each tool call is one change for the room's collaborators. Your role in a room decides what you may do: viewers and commenters can read but not edit.
- take_screenshot, ask_agent, import_html, design preferences and the desktop shell tools are not available here. Skip the screenshot steps of the workflow: check your work with get_element_code / get_element_tree and the lint report finish_artboard returns; finish_artboard reports "unverified" (say so honestly).
- Remote <img src="https://…"> photos are embedded while the call runs when they are small enough (pages share a 20 MB room budget); larger ones are marked missing.
- Give the user the room's editor URL (open_document or list_documents) so they can open it.`;

/**
 * The hosted tool definitions by name ({description, inputSchema (raw Zod shape), annotations,
 * raw?}): the shared table minus the unavailable tools, plus the cloud overrides. Definitions only;
 * run a tool with callHostedTool.
 */
export function hostedToolDefinitions() {
  const out = {};
  for (const [name, tool] of Object.entries({ ...toolTable({}), ...OVERRIDES })) {
    if (Object.hasOwn(UNAVAILABLE, name)) continue;
    out[name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      raw: !!tool.raw,
    };
  }
  return out;
}

/** True for tools that only read (MCP readOnlyHint): they run without an editor role or approval. */
export const isReadOnlyTool = (definition) => definition?.annotations?.readOnlyHint === true;

// ---------------------------------------------------------------------------------------------
// Cloud backend (the backend interface of integrations/design-tools.mjs over rooms)

const editorUrl = (origin, id) => `${origin}/#room=${id}`;

/** Every room the account reaches, like GET /api/me/rooms: direct memberships plus organizations. */
export async function accountRooms(env, account) {
  const rooms = new Map();
  for (const room of await profiles.rooms(env, account.id)) rooms.set(room.id, room);
  if (account.authUser)
    for (const room of await userOrganizationRooms(env, account.authUser.id)) {
      const direct = rooms.get(room.id);
      const role = direct && roleRank(direct.role) > roleRank(room.role) ? direct.role : room.role;
      rooms.set(room.id, { ...direct, ...room, role });
    }
  return [...rooms.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * The design-tools backend for `account` over its cloud rooms.
 * @param {object} env the Worker bindings
 * @param {Request} request the HTTP request (client address for room-creation limits, auth base URL)
 * @param {URL} url its URL (editor links use url.origin)
 * @param {object} account the signed-in account (accountOf)
 * @param {{roomId?: string}} [options] roomId scopes the backend to one room: an omitted document
 *   means that room, any other room is refused, list_documents shows only it and no room is created.
 */
export function createRoomBackend(env, request, url, account, { roomId: scope } = {}) {
  const origin = url.origin;
  const orgRole = async (id) =>
    account.authUser ? await orgRoomRole(env, id, account.authUser.id) : null;
  const resolve = async (ref) => {
    if (ref !== undefined && ref !== null && ref !== "") {
      if (!ROOM_ID.test(ref))
        throw new Error(`"${ref}" is not a room id; use an id (UUID) from list_documents`);
      if (scope && ref !== scope)
        throw new Error(`This chat works on room ${scope} only; omit "document" or pass that id`);
      return ref;
    }
    if (scope) return scope;
    const rooms = await accountRooms(env, account);
    if (rooms.length === 1) return rooms[0].id;
    throw new Error(
      rooms.length
        ? `Pass "document" to choose one of these rooms: ${rooms
            .slice(0, 50)
            .map((r) => `${r.id} (${r.title})`)
            .join(", ")}`
        : "This account has no rooms yet; call create_document first",
    );
  };
  const readRoom = async (id) => {
    const role = await orgRole(id);
    const state = await rpc(
      env.ROOMS.getByName(id).agentRead({ accountId: account.id, orgRole: role }),
    );
    try {
      validateDocument(clone(state.document));
    } catch (error) {
      throw new Error(`Room ${id} does not hold a valid version 2 design: ${error.message}`);
    }
    return { ...state, orgRole: role };
  };
  return {
    mode: "cloud",
    scope: scope || null,
    /** The caller's current role in a room (null without access) and its title. */
    async role(ref) {
      const id = await resolve(ref);
      const state = await rpc(
        env.ROOMS.getByName(id).agentRole({ accountId: account.id, orgRole: await orgRole(id) }),
      );
      return { id, role: state.role || null, title: state.title ?? null };
    },
    async list() {
      const rooms = (await accountRooms(env, account)).filter(
        (room) => !scope || room.id === scope,
      );
      return {
        documents: rooms.map((room) => ({
          name: room.id,
          title: room.title,
          role: room.role,
          ...(room.organizationId
            ? { organizationId: room.organizationId, organizationName: room.organizationName }
            : {}),
          updatedAt: room.updatedAt ?? null,
          url: editorUrl(origin, room.id),
          live: false,
        })),
        editor: null,
        headless: true,
      };
    },
    async read(ref) {
      const id = await resolve(ref);
      const state = await readRoom(id);
      return {
        document: state.document,
        revision: revisionOf(state.document),
        roomRevision: state.revision,
        role: state.role,
        name: id,
        live: false,
        headless: true,
        selection: [],
      };
    },
    async transact(ref, fn, options = {}) {
      const id = await resolve(ref);
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = await readRoom(id);
        if (!atLeast(state.role, "editor"))
          throw new Error(
            `Your role in this room (${state.role}) cannot edit; ask an owner for editor access`,
          );
        const out = fn(clone(state.document), { revision: revisionOf(state.document) });
        validateDocument(out.document);
        // Inline images and fonts the tools produced become room assets (cloud/inline-binaries.js).
        const stored = (await extractInline(env, url.origin, id, out.document, account.id)).value;
        const ops = Ops.diff(state.document, stored);
        if (!ops.length)
          return {
            result: out.result,
            revision: revisionOf(state.document),
            live: false,
            headless: true,
            name: id,
          };
        const applied = await rpc(
          env.ROOMS.getByName(id).agentApply({
            accountId: account.id,
            orgRole: state.orgRole,
            baseRevision: state.revision,
            ops,
            // Version history: a restore_version edit stores the state it replaces first.
            ...(options.actor ? { actor: options.actor } : {}),
          }),
        );
        if (applied.conflict) continue; // someone edited in between: recompute on the new snapshot
        if (!applied.applied && applied.rejected)
          throw new Error(
            `The room rejected the edit: ${(applied.reasons || []).map((r) => r?.reason || JSON.stringify(r)).join("; ") || "invalid operations"}`,
          );
        if (applied.document?.name !== state.document.name)
          await syncTitle(env, id, String(applied.document?.name || ""));
        return {
          result: out.result,
          revision: revisionOf(applied.document),
          live: false,
          headless: true,
          name: id,
        };
      }
      throw new Error("The room kept changing while this edit was applied; try again");
    },
    async create(_name, title, { organizationId: requested } = {}) {
      if (scope)
        throw new Error("This chat works on one room; creating rooms is not available here");
      if (env.ROOM_CREATION) {
        const ip = request.headers.get("CF-Connecting-IP") || "local";
        if (!(await env.ROOM_CREATION.limit({ key: ip })).success)
          throw new Error("Too many new rooms. Try again in a minute.");
      }
      let organizationId = null;
      if (account.authUser) {
        if (requested !== undefined) {
          if (!(await membership(env, requested, account.authUser.id)))
            throw new Error("You are not a member of this organization");
          organizationId = requested;
        } else
          organizationId = await ensurePersonalOrganization(
            env,
            createAuth(env, request),
            account.authUser,
          );
      } else if (requested !== undefined)
        throw new Error("Sign in with your email and password to create rooms in an organization");
      const pageId = crypto.randomUUID();
      const document = {
        version: 2,
        name: title,
        pages: [{ id: pageId, name: "Page 1", nodes: [] }],
        tokens: {},
      };
      const id = crypto.randomUUID();
      const identity = {
        id: account.id,
        email: account.email,
        handle: account.handle,
        displayName: account.displayName,
      };
      const response = await env.ROOMS.getByName(id).fetch(
        new Request("https://room/create", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-verynize-account": JSON.stringify(identity),
          },
          body: JSON.stringify({ document }),
        }),
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create the room");
      await profiles.linkRoom(env, account.id, id, "owner", result.title);
      if (organizationId)
        await addRoom(env, {
          id,
          organizationId,
          title: result.title,
          userId: account.authUser.id,
        });
      return {
        name: id,
        roomId: id,
        title: result.title,
        pageId,
        role: "owner",
        organizationId,
        revision: revisionOf(document),
        url: editorUrl(origin, id),
        live: false,
        opened: false,
        headless: true,
      };
    },
    async open({ name }) {
      const id = await resolve(name);
      const state = await readRoom(id);
      return {
        opened: false,
        headless: true,
        name: id,
        title: state.title,
        role: state.role,
        url: editorUrl(origin, id),
        note: "Give the user this URL to open the room in Verynize; open editors already show edits live.",
      };
    },
    focus: async () => ({ focused: false, headless: true }),
    /** Version history of a room (cloud/room-history.js); the room checks access on every call. */
    versions: {
      async list(ref, artboardId) {
        const id = await resolve(ref);
        const stub = env.ROOMS.getByName(id);
        const caller = { accountId: account.id, orgRole: await orgRole(id) };
        if (artboardId) return rpc(stub.historyList({ ...caller, artboardId }));
        const boards = await rpc(stub.historyList(caller));
        const out = [];
        for (const board of boards)
          out.push(...(await rpc(stub.historyList({ ...caller, artboardId: board.artboardId }))));
        return out.sort((a, b) => b.at - a.at);
      },
      async get(ref, versionId) {
        const id = await resolve(ref);
        return rpc(
          env.ROOMS.getByName(id).historyGet({
            accountId: account.id,
            orgRole: await orgRole(id),
            id: versionId,
          }),
        );
      },
      async capture(ref, artboardId, { reason, label } = {}) {
        const id = await resolve(ref);
        return rpc(
          env.ROOMS.getByName(id).historyCapture({
            accountId: account.id,
            orgRole: await orgRole(id),
            artboardId,
            reason,
            label,
          }),
        );
      },
    },
    fetchImage: (src) => fetchImageAsDataUrl(src, { maxBytes: MAX_IMAGE }),
    preferences: { list: async () => [] },
  };
}

/** Wait (bounded) until the background image jobs design-tools queued for this backend finish. */
async function settleAssets(backend) {
  const deadline = Date.now() + ASSET_WAIT_MS;
  while (Date.now() < deadline) {
    const jobs = [...sessionFor(backend).pending.values()].flatMap((set) => [...set]);
    if (!jobs.length) return;
    let timer;
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((resolve) => {
        timer = setTimeout(resolve, deadline - Date.now());
      }),
    ]);
    clearTimeout(timer);
  }
}

const textResult = (value) => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});
const toolError = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

/**
 * Run one hosted tool against a backend (createRoomBackend). Arguments are validated with the
 * tool's schema (strict). Returns an MCP tool result ({content, isError?}), or null for an unknown
 * tool. Tool failures are results with isError, never exceptions.
 */
export async function callHostedTool(backend, name, args) {
  if (Object.hasOwn(UNAVAILABLE, name)) return toolError(UNAVAILABLE[name]);
  const override = OVERRIDES[name];
  const tool = override || toolTable(backend)[name];
  if (!tool) return null;
  const parsed = z
    .object(tool.inputSchema)
    .strict()
    .safeParse(args ?? {});
  if (!parsed.success)
    return toolError(
      `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`,
    );
  try {
    if (ICON_TOOLS.has(name)) provideIconSets(await loadIconSets());
    const result = override
      ? await override.run(backend, parsed.data)
      : await tool.run(parsed.data);
    await settleAssets(backend);
    return tool.raw && Array.isArray(result?.content) ? result : textResult(result);
  } catch (error) {
    return toolError(error?.message || String(error));
  }
}
