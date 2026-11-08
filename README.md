# Verynize

A working macOS design workspace with a local canvas, project files, Claude/Codex execution, headless CLI/MCP editing, and Cloudflare collaboration. Independently implemented using evidence from installed Wonder 0.2.183, installed Pen 1.2.20, and ArtCraft's FigCraft project.

## Run

```sh
npm install
npm start
```

## Vite+ toolchain

Requires Node.js 24.11 or newer (`.nvmrc` pins 24). Vite+ is installed locally and pinned alongside its Vite core alias in `package.json`; `npm install` installs the toolchain without requiring a global CLI.

`npm start` opens the Electron app. For the Cloudflare web development server and code tools:

```sh
npm run dev
npm run lint
npm run format:check
npm run format          # Reformat repository files
npx vp toolchain
```

`vite.config.ts` uses `defineConfig` from `vite-plus` and the existing Cloudflare plugin. `npm run build` uses Vite+ to generate Cloudflare build output. Deployment commands build first, then use `cf deploy --prebuilt` to deploy that output. The existing Node/Electron test suite runs with `npm test`.

To build a standalone macOS application:

```sh
npm run package:mac
# To replace an earlier generated build: npm run package:mac -- --replace
open "dist/Verynize.app"
# Validate the app, then create the ALPHA download archive:
npm run test:package
node scripts/desktop-release.mjs
```

The ALPHA package is locally ad-hoc signed and not Apple-notarized. macOS may require an explicit approval to open it. Updates are manual. It uses its own storage and does not alter Wonder or Pen. See the [ALPHA distribution plan](docs/distribution-plan.md) for build/download acceptance and known limitations.

## Design workflows

Create pages and frames, select/drag/resize layers, align and snap, zoom/pan, and choose flex/grid/block/inline layouts. The inspector supports typography, mixed text ranges, gradients/masks, stacking, scaling, rotation, opacity, borders, shadows and frame clipping. A color picker and hex input edit fills. Import embedded images/SVG, choose authored icons, create color variables or paste CSS variables, and use animated gradient presets. Undo/redo and local persistence are built in. Export HTML, JSON, desktop PDF, or selected artwork as PNG/JPG/SVG; preview responsive layouts. SVG artwork export uses an HTML foreignObject, so support varies between SVG consumers.

Own HTML exports round-trip full supported layer data. External HTML import supports inline layout/styles rather than arbitrary application code. The shader tool includes authored WebGL Aurora, Waves, Noise, Ribbon, Mesh, and Swirl presets with editable speed/intensity/color; CSS gradient animation is also available. Native `.pen` and `.fig` file compatibility is not implemented.

The Wonder-reference shell includes a floating tool dock, docked chat, compact panels, local Inter typography and Lucide-based icons (`web/src/components/icons.tsx`). **Files** opens a persistent local library with folders, grid/list views, search across file/page/layer names and text, duplicate, rename, archive and restore. Public/private filters reflect actual snapshot publication. Three original templates provide editable landing-page, dashboard and presentation starting points. **Views** saves page, zoom and canvas position inside the document, including JSON/shared-room round trips.

**Settings** provides local display name, light/dark/system appearance, reduced motion, selection behavior and nudge distances, task notifications, model/access defaults, personal instructions, and device-recorded agent activity. This local profile is not a hosted account or billing system. Large local libraries are subject to browser storage limits; save important documents to native files.

## Projects and agents

Open **Project files** from the folder icon or chat dock to select a folder, create a project, or clone an HTTPS GitHub repository. Read/edit text files, inspect Git status, create a `design/name` worktree, and edit project memory. Worktrees require an existing Git commit. Open the created worktree folder to run tasks there.

Claude uses the local Claude Code installation/account or the SDK runtime, with separate named accounts available. Codex uses an installed recent `codex app-server` and Verynize’s own **Sign in with ChatGPT** connection; the terminal Codex login is separate and is not imported. Connect through onboarding or Settings › Accounts. Tasks stream output and support queue/stop, canvas/file attachments, provider/model/effort choices, and access controls. Session resumption and rewind are implemented, with the evidence boundaries recorded in [feature acceptance](docs/implementation-status.md). See [agent workflows](docs/agent-workflows.md) for account isolation and authentication details.

**Running app** embeds a localhost application beside the editor controls with responsive viewport choices; the project dialog can also open a separate preview window. **Capture to canvas** reads the running embedded page without reloading, preserving its current DOM and visible input state while excluding passwords. It converts visible text, hierarchy, supported backgrounds/borders/shadows and eligible same-origin bitmap images into editable layers. The desktop capture API also supports a bounded region; the UI captures the current viewport. Foreign resources are blocked, and unsupported styles produce approximation warnings. Custom font embedding, arbitrary remote-page capture, interaction recovery and source mapping are not implemented. **Apply canvas** prepares a real source-editing task for your chosen local agent.

## Figma and illustrations

**Import Figma** accepts a file/selection URL and a transient Figma personal access token with `file_content:read`. The adapter imports supported hierarchy, layout, text, paint and bitmap data, reporting approximations. Tokens are not saved. Converter/request-security tests pass; a live authenticated import has not been performed.

**Images come from chat**: ask the agent and it calls the `generate_image` tool, which uses your Codex ChatGPT plan by default (an own API key is optional, in Settings › Import & generation) and fills the selected frame or inserts an image layer. There is no separate generate dialog. **Trace selected bitmap** converts a raster into quantized SVG paths; it is a block-style trace, not smooth curve fitting.

## Shared desktop / CLI / MCP documents

Use **Save design** to save `name.verynize.json`. Open that document through the native file workflow to receive notifications when another process changes it. Saves detect external changes and require reloading rather than silently overwriting them. Switching files detaches the old native save target; a delayed Save is canceled if the document changes before completion.

```sh
npm run cli -- --root /absolute/design-folder list
npm run mcp -- --root /absolute/design-folder
```

While the desktop app runs, it serves a loopback MCP bridge with a per-launch bearer token. The bridge details are written to `~/Library/Application Support/Verynize/mcp.json`. Through it, agents edit the open document live and each tool call is one undo step. `npm run mcp` proxies to the bridge automatically. When the app is closed, it edits the `--root` files directly instead. In both modes the tool set is the same:

- **Read:** `get_design_context`, `get_element_code` (Tailwind-style JSX) and `find_elements`.
- **Write:** `create_artboard` and the `update_elements` directive script.
- **Tokens and documents:** the design-token tools and the document and page tools.
- **Also included:** screenshots, and `apply_operations` as a low-level fallback.

The same document format also supports CLI create/read/batch-edit/export. Configure your MCP client using [the integration reference](docs/figcraft-reference.md). Native document names use letters, numbers, dashes, or underscores.

## Cloudflare collaboration

```sh
npm run deploy:check
npm run deploy
```

`deploy:check` builds and validates without publishing. Deployment needs your Cloudflare account. The configured hosted origin is `https://verynize.gayaloo.app`; configuration and local test evidence do not establish the current live service status.

**Share** supports accounts, organizations, member roles, and room invitations. Desktop defaults to the configured hosted origin, and the legacy Share & collaborate settings also accept another server. Web and desktop share the document format and synchronize server-sequenced per-property operations with reconnect; legacy revision-checked snapshot writes remain supported. Joining a room detaches the previous native target. Viewer/commenter roles are read-only; legacy capability links grant their assigned role. Published snapshots are frozen and read-only. Web AI uses the user’s connected OpenRouter account/key through the backend; local project files, terminal, Git, and Claude/Codex execution remain desktop capabilities. See [deployment notes](docs/deployment.md).

ALPHA limitations include new signed-in files created offline not surviving reload, some edits across unloaded pages, and previously shared asset URLs remaining valid after membership removal. Save/export a separate copy of important work; see the full [known gaps](docs/implementation-status.md#remaining-gaps-and-live-credential-boundaries).

## Verification and evidence

```sh
npm run check
npm test
npm run deploy:check
```

Tests use actual Electron windows, SDK MCP subprocesses, temporary Git repositories, and local Cloudflare workerd/SQLite—not mocked UI success responses. They cover editing/persistence, project containment, memory, native design save, PDF bytes, local capture, MCP/CLI transactions, room authorization, durable persistence, publication, two-client synchronization and conflict choices.

- [Feature acceptance status](docs/implementation-status.md)
- [Installed Wonder evidence](docs/installed-wonder.md)
- [Installed Pen reference](docs/pen-reference.md)
- [ArtCraft/FigCraft reference](docs/figcraft-reference.md)
- [Original shipped-feature checklist](docs/wonder-roadmap.md)
- [Public Wonder repository findings](docs/wonder-repositories.md)

This is a functional independent application. Exact full parity with Wonder's hosted product is not established; remaining gaps are recorded explicitly in the acceptance status.

## License

Original Verynize code and documentation are licensed under the [MIT License](LICENSE). Third-party materials retain their own rights and licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
