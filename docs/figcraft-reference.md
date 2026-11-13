# FigCraft (ArtCraft) reference and local MCP implementation

Investigated 2026-10-28 via Agent Reach's GitHub CLI route.

## Identity and license

The requested reference is [storytold/figcraft](https://github.com/storytold/figcraft), not the unrelated SVG library or Figma plugin with the same name. Its README links [ArtCraft's FigCraft page](https://getartcraft.com/apps/figcraft). The inspected `main` commit was `90054a89c4ca8a96db6e3a26cd3af3a475eaa2d7`.

The repository has both [LICENSE-MIT](https://github.com/storytold/figcraft/blob/90054a89c4ca8a96db6e3a26cd3af3a475eaa2d7/LICENSE-MIT) and [LICENSE-APACHE](https://github.com/storytold/figcraft/blob/90054a89c4ca8a96db6e3a26cd3af3a475eaa2d7/LICENSE-APACHE); the README declares MIT OR Apache-2.0. GitHub's repository metadata detected Apache-2.0. No FigCraft source code or assets were copied into this implementation.

## Observed reference

The [README](https://github.com/storytold/figcraft/blob/90054a89c4ca8a96db6e3a26cd3af3a475eaa2d7/README.md) describes a native Rust, offline-first design application with frames, auto layout, components, variants, vectors, variables, prototypes and collaboration. It identifies itself as early alpha. These are repository declarations, not runtime-tested capabilities in this investigation.

Its [MCP documentation](https://github.com/storytold/figcraft/blob/90054a89c4ca8a96db6e3a26cd3af3a475eaa2d7/docs/mcp.md) documents headless and attached operation, JSON-RPC over stdio, constrained read/write roots, and commands shared with the UI. This is the concrete reference used for Verynize's automation implementation. FigCraft's `.fig` import is described as best effort; this does not establish Verynize Figma import support.

## Implemented here

Verynize exposes one tool set over two transports. The tools, schemas and handlers live in `integrations/design-tools.mjs`; the JSX/Tailwind codec is `integrations/jsx-codec.mjs`; short ids, JSX-to-node building and the directive script are in `integrations/design-edit.mjs`. All of it is independently written.

- **Live bridge (desktop app).** `desktop/mcp-bridge.cjs` starts a Streamable HTTP MCP server on `http://127.0.0.1:<random port>/mcp` at launch. It requires `Authorization: Bearer <token>`, where the token is random per launch, and it refuses browser `Origin` headers and foreign `Host` headers. The bridge writes `{url, token, pid}` to `~/Library/Application Support/Verynize/mcp.json` (mode 0600) and removes the file on quit. Calls aimed at the document open in the editor are relayed over IPC (`bd:mcp-call` / `bd:mcp-reply`) to `web/agent-bridge.js`, which applies them with the editor's own `setDocument`. Edits therefore render immediately, persist the same way user edits do, and count as one undo step per tool call. A call that names a saved document that is not open is applied on disk in `<userData>/documents`.
- **Stdio (`integrations/mcp-server.mjs`).** When `mcp.json` points at a reachable bridge, this server proxies every call to the bridge, so edits are live. Otherwise it edits `NAME.verynize.json` files under `--root` ("headless"). If the bridge stops during a session, it falls back to `--root` when one was given.

Tools: `get_design_context`, `get_artboards`, `get_element_tree`, `get_element_code`, `find_elements`, `take_screenshot`, `create_artboard`, `update_elements`, `duplicate_elements`, `delete_elements`, `rename_elements`, `finish_artboard`, `get_design_tokens`, `create_design_tokens`, `update_design_tokens`, `delete_design_tokens`, `bind_variables`, `list_documents`, `open_document`, `create_document`, `create_page`, `rename_page`, plus the low-level `read_document`, `apply_operations` (revision-checked batches) and `export_document`.

- **Element ids.** Elements carry a persisted, page-unique `shortId`. An artboard is addressed as `bok`; a descendant is addressed as `bok.tem`.
- **Reading and writing.** Elements are read and written as Tailwind-style JSX:
  - frames are `<div>…</div>`
  - rectangles are `<div />`
  - text elements may contain `<b>`, `<i>`, `<span>` and `<br />`
  - images are `<img src="data:…">`
  - WebGL fills are `<Shader preset>`
  - token colors are written as `bg-[var(--color-x)]`
- **No code execution.** JSX attribute and child expressions are limited to literals.
- **`update_elements` directives.** Supported: `edit`, `replace`, `insert as first/last child of`, `insert before/after` and `delete`. Each directive applies independently, and the result lists OK or FAIL for each one.
- **`take_screenshot`.** In the app, the screenshot is captured by the live renderer, or by an offscreen window when the element is not on the active page. In headless stdio mode the tool reports that screenshots are unavailable.
- **Token names.** Tokens map onto the existing hex color variables. A name such as `color/text/primary` becomes `var(--color-text-primary)`.

Document files end in `.verynize.json` and share the editor's version 2 schema: `{version:2,name,pages:[{id,name,nodes}],tokens:{}}`. Nodes reference parent frames using `parentId`. Validation and file safety:

- Hierarchy cycles, duplicate IDs, invalid geometry and missing parents are rejected.
- Deleting a frame deletes its descendants.
- Lock files serialize writers. Writes go to a temporary file and are then renamed into place.
- Names cannot include path separators, and existing document symlinks are refused.
- No tool accepts arbitrary filesystem paths or commands.

## Run and configure

With the desktop app running, external clients can connect straight to the bridge using the URL and token from `mcp.json`:

```sh
cat ~/Library/Application\ Support/Verynize/mcp.json
claude mcp add --transport http verynize <url> --header "Authorization: Bearer <token>"
```

The token changes each launch. To avoid copying it each time, configure the stdio server instead. It finds the running app automatically, and the `--root` folder is used when the app is closed (no client settings were changed here):

```json
{
  "mcpServers": {
    "verynize": {
      "command": "node",
      "args": [
        "/absolute/path/to/verynize/integrations/mcp-server.mjs",
        "--root",
        "/absolute/path/to/designs"
      ]
    }
  }
}
```

Flags:

- `--no-bridge` forces file mode.
- `--bridge-file FILE` (or `$VERYNIZE_MCP_FILE`) points at a different bridge file.
- `VERYNIZE_DISABLE_MCP=1` stops the app from starting the bridge.
- In-app agent runtimes get `{url, token}` from `getBridgeInfo()` in `desktop/mcp-bridge.cjs`. The header comment of that file shows the matching Claude `--mcp-config` and Codex `-c mcp_servers…` settings.

The stdio server reserves stdout for MCP protocol traffic. It requires the root project's `@modelcontextprotocol/sdk` and `zod` dependencies.

## Verification

`node --test integrations/*.test.mjs` passed all four tests: CRUD/reopen persistence, stale revision detection, descendant deletion, batch rollback/cycle rejection, traversal and symlink rejection, and an actual SDK client-to-child-process stdio MCP session that created and edited a saved file.

Context7 resolved the official `/modelcontextprotocol/typescript-sdk` library and queried version `1.32.2` for `McpServer.registerTool`, Zod schemas, `StdioServerTransport`, and `StdioClientTransport`. Official retrieved sources: [server documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/docs/server.md), [client documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/docs/client.md).

## Shared desktop files

The desktop bridge `desktop/design-files.cjs` adds native open/save dialogs and watches the selected document's directory. Saving a document as `name.verynize.json` inside the MCP root makes it available to both interfaces. External atomic MCP changes emit `design:file-changed`; the UI can ask whether to reload them. Saving a stale desktop version is refused until reloaded, avoiding silent lost updates. Renderer requests contain document data, never arbitrary disk paths. Native dialogs grant the file selection.

`export_document` now provides a fifth MCP tool: standalone, inert HTML for a selected page with nested frames, flex/grid, embedded images and text. It returns HTML as tool data and does not write arbitrary export paths. Font and layout fidelity against the desktop is not asserted.

The expanded suite now has six passing tests, adding filesystem-watch delivery of MCP writes to a desktop file session, stale-desktop-save rejection, reload/resave, and native file extension validation. The real MCP stdio test also exercises HTML export.

## Command-line interface

The independently authored `integrations/design-cli.mjs` shares the same DesignStore and HTML exporter with MCP and desktop file handling. It does not require FigCraft to be installed.

```sh
node integrations/design-cli.mjs --root /absolute/path/to/designs list
node integrations/design-cli.mjs --root /absolute/path/to/designs create landing 'Landing page'
node integrations/design-cli.mjs --root /absolute/path/to/designs read landing
# Supply revision from read and a JSON array of operations on stdin:
node integrations/design-cli.mjs --root /absolute/path/to/designs apply landing REVISION < operations.json
node integrations/design-cli.mjs --root /absolute/path/to/designs export landing > landing.html
```

The shared schema supports free, flex, grid, block and inline frame layouts; CSS gradient masks; and mixed bold/italic text ranges. Numeric MCP font weights normalize to strings for the browser editor. Tokens are six-digit hex colors. Imported images must be embedded data images. Geometry is finite and bounded, documents are capped at 20 MiB / 100 pages / 10,000 nodes total (5,000 per page); these automation limits can be stricter than renderer editing limits. Text edits clear old styling ranges unless replacement ranges are explicitly supplied.

Final integration suite: eight passing tests, including command-line child processes and an actual MCP session creating nested grid/text/image nodes and exporting escaped HTML with mixed styles. CLI and MCP use the same store, so files created in either are accessible by the other and by the desktop file bridge.

## WebGL shader interchange and export

Shader layers are persisted as `type:"shader"`, `shaderPreset:"aurora"|"waves"|"noise"`, `shaderSpeed` (0–5), and `shaderIntensity` (0–2). Existing color variables feed the RGB uniform. CLI/MCP reject invalid presets and out-of-range/non-finite uniforms before persistence. No arbitrary shader or JavaScript source is accepted as a rendering parameter.

Unlike exports containing only static layers, **shader HTML exports include JavaScript**: the same independently authored `web/shaders.js` runtime used by the editor, embedded once, followed by its mounting call. All node content remains escaped data. WebGL availability is environment-dependent and the renderer displays a fallback when unavailable. These presets are implemented locally; they are not Wonder's proprietary shader library.

Context7 `/mdn/content` was queried for WebGL uniform updates, animation, context-loss handling and resource cleanup. Added three shader integration checks: input validation; trusted runtime embedding/content escaping; and a real Electron iframe that compiled and drew the exported shader, read distinct opaque nonzero GPU pixels at two coordinates, reported no GL error, and confirmed injected document text did not execute. The complete integration suite now contains eleven tests.
