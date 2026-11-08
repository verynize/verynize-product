// Bridge-only "shell" tools: the user's running app (dev server, embedded preview, terminal) and
// the editor's command registry. Merged into the shared tool table by design-tools.mjs, so the
// stdio server lists them too; they only work when the backend has `shell` (the desktop bridge,
// desktop/agent-shell.cjs). Headless file mode answers with a clear "needs the desktop app" error.
//
//   backend.shell.call(op, args, context) -> result      context: {access?} from the bridge request
//
// Approval and access policy live in the desktop app (desktop/agent-shell.cjs), not here.
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const SHELL_TOOL_NAMES = [
  "get_dev_server",
  "start_dev_server",
  "stop_dev_server",
  "configure_dev_server",
  "propose_preview",
  "preview_open",
  "preview_snapshot",
  "preview_screenshot",
  "preview_click",
  "preview_type",
  "preview_scroll",
  "preview_console",
  "capture_preview_to_canvas",
  "run_terminal_command",
  "read_terminal",
  "execute_action",
];

export const SHELL_INSTRUCTIONS = `## Running app and editor actions (desktop app only)
When asked to set up preview, inspect the repository scripts and package manager, then call propose_preview with setup/run argv and port. In ask/edit access it creates a review card in chat; in auto/full access it is saved directly as the Preview configuration. Either way, do not configure or start the server yourself: the user starts it with Start preview. With a project folder open in Verynize: get_dev_server reports its dev server; start_dev_server runs it (the package.json dev/start script, or a command saved with configure_dev_server) and opens it in the preview pane. Inspect the running app with preview_snapshot (page outline with CSS selectors for controls), preview_screenshot and preview_console; drive it with preview_click, preview_type and preview_scroll; capture_preview_to_canvas turns the visible page into editable layers. run_terminal_command runs one argument array in the project folder (no shell; use background:true for long-running processes) and read_terminal reads dev server or background output. Starting servers and running commands may need the user's approval; if the user declines, do not retry unchanged. execute_action runs an editor command (align, distribute, frame selection, auto layout, z-order, zoom to fit…) on the given element ids; call it without id to list actions. These tools need the desktop app.`;

const argv = z
  .array(z.string().max(4096))
  .min(1)
  .max(64)
  .describe(
    'Program and arguments as an array, e.g. ["npm","run","build"]. No shell: pipes, globs and && are not interpreted.',
  );
const localUrl = z
  .string()
  .max(2000)
  .regex(
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i,
    "Use a localhost URL such as http://localhost:3000",
  );
const selector = z.string().min(1).max(1000).describe("CSS selector, e.g. from preview_snapshot");
const coord = z.number().finite().min(0).max(20000);
const timeoutMs = z
  .number()
  .int()
  .min(0)
  .max(15000)
  .optional()
  .describe("How long to wait for the selector to appear (ms, default 3000)");

const needsApp = (name) =>
  new Error(
    `${name} needs the Verynize desktop app: it drives the app's dev server, running-app preview, terminal and editor. Start Verynize (this server then proxies to it automatically); headless file mode has no shell.`,
  );

/**
 * helpers: {readPrepared, write, getPage, indexPage, invalidate(name)} from design-tools.mjs.
 */
export function shellToolTable(backend, context = {}, helpers) {
  const { readPrepared, write, getPage, indexPage, invalidate } = helpers;
  const shell = (name) => {
    if (!backend.shell || typeof backend.shell.call !== "function") throw needsApp(name);
    return backend.shell;
  };
  const call = (name, op, args = {}) => shell(name).call(op, args, context);
  const t = {};
  t.get_dev_server = {
    description:
      "Status of the open project's dev server: state (stopped|starting|running|exited|failed), command, localhost URL, the detected package.json command, any saved command, recent output, and background terminal commands. Desktop app only.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    run: () => call("get_dev_server", "devStatus"),
  };
  t.start_dev_server = {
    description:
      "Start the open project's dev server (once per project) and wait until its localhost URL answers, then open it in the preview pane. Uses command if given, else the command saved with configure_dev_server, else the package.json dev/start/serve/preview script with the project's package manager. May ask the user to approve. Returns the status with the URL and recent output; check tail when state is failed.",
    inputSchema: {
      command: argv.optional(),
      url: localUrl.optional().describe("Preview URL when the server does not print one"),
      waitMs: z
        .number()
        .int()
        .min(0)
        .max(120000)
        .optional()
        .describe("How long to wait for the URL (default 20000)"),
      open: z.boolean().optional().describe("Open the URL in the preview pane (default true)"),
    },
    run: (args) => call("start_dev_server", "devStart", args),
  };
  t.stop_dev_server = {
    description: "Stop the open project's dev server (its whole process group).",
    inputSchema: {},
    annotations: { destructiveHint: true },
    run: () => call("stop_dev_server", "devStop"),
  };
  t.configure_dev_server = {
    description:
      "Save the dev server command for the open project (used by start_dev_server from now on), or pass command:null to forget it and fall back to package.json detection. May ask the user to approve.",
    inputSchema: { command: argv.nullable(), url: localUrl.optional() },
    run: (args) => call("configure_dev_server", "devConfigure", args),
  };
  t.propose_preview = {
    description:
      "Propose preview setup for the active chat. Never executes commands or starts the server. Inspect repository scripts first, then supply setup and run command arrays and the listening port. In ask/edit access the user reviews, edits, saves and starts it in a chat card; in auto/full access it is saved directly as the repository's Preview configuration (result saved:true) and the user starts it with Start preview and can change it in Preview settings.",
    inputSchema: {
      command: argv,
      setup: argv.optional(),
      port: z.number().int().min(1).max(65535),
      chatId: z.string().max(200).optional(),
      name: z.string().max(200).optional(),
    },
    run: (args) => call("propose_preview", "devPropose", args),
  };
  t.preview_open = {
    description:
      "Open a localhost URL in Verynize's running-app preview pane and wait for it to load. Without url: show the current preview again, or the running dev server.",
    inputSchema: {
      url: localUrl.optional(),
      reload: z
        .boolean()
        .optional()
        .describe("Reload even when the URL is already open (default true)"),
    },
    run: (args) => call("preview_open", "previewOpen", args),
  };
  t.preview_snapshot = {
    description:
      'Read the page in the preview: an outline of landmarks, headings, text, links and form controls, each control with a CSS selector for preview_click/preview_type (mode "outline", default), or the visible text (mode "text"). Password values are never returned. Bounded by maxChars.',
    inputSchema: {
      selector: selector.optional().describe("Limit to this element"),
      mode: z.enum(["outline", "text"]).optional(),
      maxChars: z.number().int().min(1000).max(60000).optional(),
    },
    annotations: { readOnlyHint: true },
    run: (args) => call("preview_snapshot", "previewSnapshot", args),
  };
  t.preview_screenshot = {
    description:
      "PNG of the preview viewport (or of one element, scrolled into view) as the user sees it. Shows the preview pane if it was hidden.",
    inputSchema: {
      selector: selector.optional(),
      maxWidth: z.number().int().min(200).max(2400).optional(),
    },
    annotations: { readOnlyHint: true },
    raw: true,
    run: async (args) => {
      const shot = await call("preview_screenshot", "previewScreenshot", args);
      const { data, mimeType, ...meta } = shot;
      return {
        content: [
          { type: "image", data, mimeType: mimeType || "image/png" },
          { type: "text", text: JSON.stringify(meta) },
        ],
      };
    },
  };
  t.preview_click = {
    description:
      "Click in the preview with a real mouse event: the element matching selector (scrolled into view, center) or the viewport point x,y. Reports navigation and warns when another element covers the target.",
    inputSchema: {
      selector: selector.optional(),
      x: coord.optional(),
      y: coord.optional(),
      doubleClick: z.boolean().optional(),
      timeoutMs,
    },
    run: (args) => call("preview_click", "previewClick", args),
  };
  t.preview_type = {
    description:
      "Type text into the preview: clicks the selector (or x,y) to focus it first, else types into the focused field. clear replaces the current value; submit presses Enter afterwards.",
    inputSchema: {
      text: z.string().max(10000),
      selector: selector.optional(),
      x: coord.optional(),
      y: coord.optional(),
      clear: z.boolean().optional(),
      submit: z.boolean().optional(),
      timeoutMs,
    },
    run: (args) => call("preview_type", "previewType", args),
  };
  t.preview_scroll = {
    description:
      'Scroll the preview: selector alone scrolls that element into view; deltaX/deltaY scroll the page (or the scroll container under selector / the viewport center); to "top" or "bottom" jumps.',
    inputSchema: {
      selector: selector.optional(),
      deltaX: z.number().finite().min(-100000).max(100000).optional(),
      deltaY: z.number().finite().min(-100000).max(100000).optional(),
      to: z.enum(["top", "bottom"]).optional(),
    },
    run: (args) => call("preview_scroll", "previewScroll", args),
  };
  t.preview_console = {
    description:
      "Console messages, page errors and navigations of the preview (newest last, bounded buffer). Pass since (latestSeq of a previous call) to get only new entries, level to filter (warning includes errors).",
    inputSchema: {
      since: z.number().int().min(0).optional(),
      level: z.enum(["debug", "info", "warning", "error"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    annotations: { readOnlyHint: true },
    run: (args) => call("preview_console", "previewConsole", args),
  };
  t.capture_preview_to_canvas = {
    description:
      "Capture the page visible in the preview (or a viewport region) into the open design as a new editable artboard of positioned layers (text, styles, same-origin images; passwords masked). Returns the artboard id and capture warnings. One undo step.",
    inputSchema: {
      document: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/)
        .optional()
        .describe("Saved document name; omit for the document open in the editor"),
      pageId: z.string().min(1).max(200).optional(),
      region: z
        .object({
          x: coord,
          y: coord,
          width: z.number().finite().min(1).max(20000),
          height: z.number().finite().min(1).max(20000),
        })
        .strict()
        .optional()
        .describe("Viewport region in CSS px"),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      label: z.string().trim().min(1).max(200).optional(),
    },
    run: async ({ document: ref, pageId, region, x, y, label }) => {
      const captured = await call(
        "capture_preview_to_canvas",
        "previewCapture",
        region ? { region } : {},
      );
      const nodes = (captured.document?.pages || []).flatMap((page) => page.nodes || []);
      if (!nodes.length) throw new Error("The capture produced no layers");
      let rootLong = null;
      const out = await write(backend, ref, (document) => {
        const page = getPage(document, pageId);
        const ids = new Map(nodes.map((node) => [node.id, randomUUID()]));
        const roots = page.nodes.filter((node) => !node.parentId);
        const right = roots.length
          ? Math.max(...roots.map((node) => (Number(node.x) || 0) + (Number(node.w) || 0))) + 120
          : 0;
        const placed = nodes.map((node) => ({
          ...node,
          id: ids.get(node.id),
          parentId: node.parentId ? (ids.get(node.parentId) ?? null) : null,
        }));
        const root = placed.find((node) => !node.parentId);
        root.name = label || `Captured · ${String(captured.document.name || "app").slice(0, 120)}`;
        root.x = x ?? right;
        root.y = y ?? (roots.length ? Math.min(...roots.map((node) => Number(node.y) || 0)) : 0);
        rootLong = root.id;
        page.nodes.push(...placed);
        return { document, result: { pageId: page.id } };
      });
      const state = await readPrepared(backend, ref ?? (out.live ? undefined : out.name));
      const index = indexPage(getPage(state.document, out.result.pageId));
      const root = index.byId.get(rootLong);
      return {
        id: root ? index.shortId(root) : null,
        pageId: out.result.pageId,
        layers: nodes.length,
        region: captured.region,
        warnings: captured.warnings || [],
        live: out.live,
        revision: out.revision,
        next: "take_screenshot the new artboard to compare it with preview_screenshot; refine it with update_elements.",
      };
    },
  };
  t.run_terminal_command = {
    description:
      "Run one command in the open project folder (argument array, no shell, stdin closed) and return its exit code and output (last 30,000 characters). timeoutMs kills it (default 60 s, max 10 min). background:true returns at once with an id for read_terminal (for watchers and servers). May ask the user to approve.",
    inputSchema: {
      argv,
      timeoutMs: z.number().int().min(1000).max(14_400_000).optional(),
      background: z.boolean().optional(),
    },
    run: (args) => call("run_terminal_command", "terminalRun", args),
  };
  t.read_terminal = {
    description:
      'Read output of the dev server (id "dev-server") or of a background command (its id). Without id: list terminals. since (from a previous nextSeq) returns only newer lines. stop:true stops that process.',
    inputSchema: {
      id: z.string().min(1).max(200).optional(),
      since: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(2000).optional(),
      stop: z.boolean().optional(),
    },
    run: ({ id, since, limit, stop }) => {
      if (stop) {
        if (!id) throw new Error("stop needs the terminal id");
        return call("read_terminal", "terminalStop", { id });
      }
      return call("read_terminal", "terminalRead", { id, since, limit });
    },
  };
  t.execute_action = {
    description:
      'Run an editor command by id on the document open in the editor, exactly like its shortcut or menu item (one undo step): align/distribute, frame/unframe selection, add/remove auto layout, z-order, show/hide, lock, select parent/children, zoom to fit/selection, undo/redo… ids sets the selection first (element ids like "bok.tem"). paramsList runs the action once per entry with its own ids. Without id: the list of actions.',
    inputSchema: {
      id: z.string().min(1).max(100).optional(),
      ids: z.array(z.string().min(1).max(200)).max(500).optional(),
      pageId: z.string().min(1).max(200).optional(),
      paramsList: z
        .array(z.object({ ids: z.array(z.string().min(1).max(200)).max(500) }).strict())
        .min(1)
        .max(50)
        .optional(),
    },
    run: async ({ id, ids, pageId, paramsList }) => {
      if (!id) {
        const { actions } = await call("execute_action", "actions");
        return { actions, usage: 'execute_action {id:"align.left", ids:["bok.tem","bok.qua"]}' };
      }
      shell("execute_action");
      const state = await readPrepared(backend, undefined);
      if (!state.live)
        throw new Error(
          "execute_action works on the document open in the editor; open it with open_document first",
        );
      const page = getPage(state.document, pageId);
      const index = indexPage(page);
      const runs = paramsList?.length ? paramsList : [{ ids }];
      const results = [];
      for (const entry of runs) {
        const longIds = entry.ids ? entry.ids.map((ref) => index.require(ref).id) : undefined;
        const reply = await call("execute_action", "action", { id, ids: longIds, pageId: page.id });
        results.push({
          ids: entry.ids ?? null,
          ran: !!reply?.ran,
          ...(reply?.ran
            ? {}
            : {
                reason: "Not available in this context (most actions need a selection: pass ids)",
              }),
        });
      }
      invalidate(state.name);
      const after = await readPrepared(backend, undefined);
      const afterIndex = indexPage(getPage(after.document, page.id));
      const selection = (after.selection || [])
        .map((nodeId) => afterIndex.byId.get(nodeId))
        .filter(Boolean)
        .map((node) => afterIndex.shortId(node));
      const ran = results.filter((r) => r.ran).length;
      return {
        action: id,
        ran,
        failed: results.length - ran,
        results,
        selection,
        revision: after.revision,
      };
    },
  };
  return t;
}
