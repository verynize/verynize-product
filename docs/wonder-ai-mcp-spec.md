# Wonder AI agent and MCP integration: behavioral spec and Verynize parity plan

Written 2026-10-28 against the installed Wonder desktop app, version 0.2.183 (`so.wonder.desktop`). This document describes behavior and interfaces in our own words. It contains no Wonder source code, and no prompt text is copied at length. Tool names, parameter keys, IPC channel names and short identifiers are recorded because they define the interface. The companion document for the canvas and node model is `docs/wonder-canvas-spec.md`.

## Evidence sources and labels

| ID    | Source                                                                               | How it was read                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M** | `app.asar` → `dist-electron/main.js` (3.2 MB, minified)                              | Extracted to `/tmp/wonder-asar-full` and read with grep                                                                                                                                                                                                                                       |
| **P** | `dist-electron/preload.js`                                                           | Same extraction                                                                                                                                                                                                                                                                               |
| **T** | `~/Library/Application Support/Wonder/agent-text.json`                               | The server-served text catalog, version-hashed, 817 keys. It holds the persona, local tool descriptions, argument descriptions, prompts, result strings and context-block templates. `main.js` looks up every description by key and logs "Agent text … is not served" when a key is missing. |
| **R** | Renderer chunks from `app.wonder.so/assets/*.js`, taken from the Chromium HTTP cache | Brotli-decoded into `/tmp/wonder-renderer`, then read statically. Never executed.                                                                                                                                                                                                             |
| **X** | The user's own Claude Code transcripts of Wonder-run chats                           | `~/.claude/projects/-Users-me-wonder-workspaces-belajar-wonder-piranha/e85c1bff….jsonl` (243 tool calls) and `…-Wonder-agent-workdirs-63fa385d…/787119cd….jsonl`. These record real tool inputs and outputs, the server instructions and the system prompt layout.                            |

Each claim is labeled **[O]** observed, **[I]** inferred, or **[U]** unknown.

---

## 1. Which MCP tools agents get, where they are served, and how calls reach the live canvas

### 1.1 Three tool sources

1. **[O] Hosted Wonder MCP: `https://mcp.wonder.so/mcp`.**
   - Server name `wonder`, so tools appear as `mcp__wonder__*`.
   - Staging is `staging-mcp.wonder.so/mcp`. When the API origin is localhost, the URL becomes `<origin>/mcp` (M: the function that maps `api.wonder.so` to the MCP URL).
   - It is passed to the SDK as `{type:'http', url, headers}`.
   - Headers:
     - `X-Wonder-Arg-Streaming: v1`
     - `Authorization: Bearer <wonder session token>`
     - `X-Wonder-Agent-Thread`, `X-Wonder-Agent-Turn` / `-Turns`
     - `X-Wonder-Host` (e.g. `desktop-worktree`)
     - `X-Wonder-Time-Zone`
     - `X-Wonder-Image-Models`, `X-Wonder-Vector-Models`
     - `X-Wonder-App-Version`, `-Release`, `-OS`, `-Arch`, `-App-Surface`
   - **All canvas and design tools live here, on the server.** No canvas tool is implemented in the desktop app. **[O]**
2. **[O] In-process Claude Agent SDK servers**, built with `createSdkMcpServer` + `tool()` in main.js. There are three:
   - `wonder-shell`: `get_dev_server_status`, `stop_dev_server`, `propose_dev_server_config`, `open_preview`, `read_preview`, `read_preview_console`, `screenshot_preview`, `capture_preview`, `click_preview`, `scroll_preview`, `type_preview`, `run_in_terminal`, `read_terminal`, `ask_user`, `work_on_pull_request`
   - `wonder-preferences`: `list_design_preferences`, `save_design_preference`, `update_design_preference`, `delete_design_preference`
   - `wonder-agents`: `ask_agent`, `wait_agent`, `stop_agent`. These ask another model (Codex/Claude) for a review or second opinion; the call returns a `run_id`.
3. **[O] For Codex, the same local tools are served by a loopback Streamable-HTTP MCP server.** It uses `@modelcontextprotocol/sdk` `McpServer` + `WebStandardStreamableHTTPServerTransport`, with a fast path that answers `tools/call` directly. It is passed to `codex app-server` through `thread/start` `config.mcp_servers`.

**[O]** PreToolUse hooks auto-allow anything matching `mcp__wonder__.*`, the shell server and the preferences server, plus `mcp__wonder_[a-z][a-z0-9]*__.*`. The exception is preference writes, which still ask.

### 1.2 Hosted tool catalog

Names come from the transcripts' deferred-tool list (X). Parameter keys come from real calls (X). Full JSON schemas are only served after auth, so required/optional status is **[U]** unless a call shows it.

| Tool                                                                                                                                                                                       | Observed params (X)                                                                   | Behavior (observed results)                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_design_context`                                                                                                                                                                       | `pageId`                                                                              | Markdown with three parts. **Basic info** is JSON: user, current org/file/page/branch, `pages[]`, `hasSelection`, `selectedElements[]`, `openFiles[] {fileId,fileName,pageId,branchName,focused}`, `designTokens[]`, `icons[]`. **Artboards** lists the active page. **Design guidelines** holds the Design Fundamentals text. This is the agent's entry point. |
| `get_basic_info`                                                                                                                                                                           | `pageId?` [I]                                                                         | The basic-info subset. [I]                                                                                                                                                                                                                                                                                                                                      |
| `get_artboards`                                                                                                                                                                            | `pageId`                                                                              | Array of `{dataNodeId, dataNodeLabel, x, y, width, height, descendantsCount, descendantsDepth, topLevelChildren[{dataNodeId,dataNodeLabel,tag}], topLevelChildrenTruncated}`                                                                                                                                                                                    |
| `get_element_tree`                                                                                                                                                                         | `pageId`, ids [I]                                                                     | Tag-only tree lines: `<tag data-node-id data-node-label>`                                                                                                                                                                                                                                                                                                       |
| `get_element_code`                                                                                                                                                                         | `pageId`, `dataNodeIds[]` (a single `dataNodeId` is rejected), `depth?`               | `{results:[{dataNodeId, code}]}`, where `code` is Tailwind JSX (see §3). Large outputs (100–200 KB) were saved to files.                                                                                                                                                                                                                                        |
| `find_elements`                                                                                                                                                                            | `pageId`, `scope` (artboard id), `queries[{query, match:['text',…]}]`, `limit`        | Matches with `dataNodeId`, label, tag, `artboardId`, depth, `ancestors[]`, `matchedOn`, `matchSnippet`                                                                                                                                                                                                                                                          |
| `take_screenshot`                                                                                                                                                                          | `pageId`, `dataNodeId`                                                                | An image (JPEG blob). Called 53 times in one session, because the agent verifies its work visually.                                                                                                                                                                                                                                                             |
| `create_artboard`                                                                                                                                                                          | `pageId`, `code` (JSX with leading `import` lines)                                    | `{trees:[…]}`, the created tree with newly assigned `data-node-id`s                                                                                                                                                                                                                                                                                             |
| `update_elements`                                                                                                                                                                          | `pageId`, `edit` (directive script, §3.3)                                             | Per-directive OK/FAIL report with the resulting element JSX                                                                                                                                                                                                                                                                                                     |
| `duplicate_elements`                                                                                                                                                                       | `pageId`, `dataNodeId`, `newArtboard`, `propertyOverrides?`, `count?`                 | `{trees, newDuplicateIds}`                                                                                                                                                                                                                                                                                                                                      |
| `delete_elements`, `rename_elements`                                                                                                                                                       | `pageId`, ids [I]                                                                     |                                                                                                                                                                                                                                                                                                                                                                 |
| `finish_artboard`                                                                                                                                                                          | `pageId`, `artboardId`                                                                | `{status, headless, designLink:{name,url}, note}`. Marks the agent's work on that artboard as finished and returns a deep link, which the chat renders as a chip.                                                                                                                                                                                               |
| `create_design_tokens` / `get_…` / `update_…` / `delete_…`                                                                                                                                 | `pageId`, `tokens[{name:'color/text/primary', type:'color'\|'fontFamily'\|…, value}]` | Returns `{created[], tokens[{id:'tok_…', name, type, cssVar:'var(--color-text-primary)', value}]}`. The token name `a/b/c` maps to the CSS variable `--a-b-c`.                                                                                                                                                                                                  |
| `get_icons` / `create_icons` / `update_icons` / `delete_icons`                                                                                                                             | `names?` [I]                                                                          | The file's icon library. Designs import it as `import { X } from 'wonder-icons'`.                                                                                                                                                                                                                                                                               |
| `generate_image`, `generate_svg`, `vectorize_image`                                                                                                                                        | [U]                                                                                   | Image generation; models are chosen by the `X-Wonder-Image-Models` / `-Vector-Models` headers                                                                                                                                                                                                                                                                   |
| `fetch_image_content`, `fetch_image_description`                                                                                                                                           | [U]                                                                                   | Read the image assets on the canvas                                                                                                                                                                                                                                                                                                                             |
| `prepare_image_upload`                                                                                                                                                                     | `pageId`, `sizeBytes`                                                                 | `{uploadUrl, method:'PUT', expiresAt, maxBytes:104857600}`. The agent then `curl -T` uploads a local image.                                                                                                                                                                                                                                                     |
| `get_skills`                                                                                                                                                                               | `skill`                                                                               | Returns markdown playbooks. Known skills: `new-design`, `edit-design`, `code-to-design`, `design-to-code`, `design-library`, `generate-assets`, `new-design-references`, `new-design-arrange`, `design-review`, `design-to-code-pull-request`                                                                                                                   |
| `get_design_guidelines`                                                                                                                                                                    | style [I]                                                                             | Style guides (named aesthetics)                                                                                                                                                                                                                                                                                                                                 |
| `get_wonder_info`, `get_additional_context`                                                                                                                                                | [U]                                                                                   | Product help, plus extra context                                                                                                                                                                                                                                                                                                                                |
| `list_files`, `open_file`, `create_file` (`name`, `organizationId`), `create_folder`, `create_page`, `rename_file`, `rename_page`, `move_file`, `move_page`, `list_file_move_destinations` |                                                                                       | `create_file` returns `{fileId, pageId, url, branchName, addedToWorktreeFiles, note}`                                                                                                                                                                                                                                                                           |
| `execute_action`                                                                                                                                                                           | `id`, `params?`, `paramsList?` (batch) [O via T `editor/execute_action.*`]            | Runs a command-palette action from the editor's action registry (§4.4). Errors include unknown-action, unavailable-in-context, param-required/wrong-type/out-of-range/no-match, "read action not batchable" and "batch-partial".                                                                                                                                |
| `ask_question`                                                                                                                                                                             | [O via T `editor/ask_question.no-answer`]                                             | The question card shown on the web surface                                                                                                                                                                                                                                                                                                                      |

**[O]** The renderer chunk `mcp-*.js` contains these constants:

- the MCP URL
- docs URL `wonder.design/docs/mcp`
- OAuth issuer `https://oauth.wonder.so`, so third-party clients use OAuth
- the list of "streaming/long" tools: `update_elements`, `create_artboard`, `duplicate_elements`, `generate_image`, `generate_svg`, `vectorize_image`

**[O]** When the user has turned off "agents create files" in Settings → Agents, main passes `disallowedTools: [mcp__wonder__create_file, create_folder, create_page]`. It also refuses `execute_action` with id `create-page`/`create-folder`.

### 1.3 How a tool call reaches the live canvas

- **[O] The source of truth is a server-side Yjs document per file/branch**, synced to every open tab with Hocuspocus (R `file.svelte-*`). Root maps:
  - `pages`
  - `pageNodes`
  - `variables`
  - `icons`
  - `docMeta`
  - `renderHints`
- **[I]** The hosted MCP server edits that document on the server. The open editor sees the change through normal collaborative sync, with no IPC involved.
- **[O]** `finish_artboard` returns `"headless": true`, so the server applies edits without needing an open tab. The persona says the tools work "in any Wonder file the user can reach, open or not".
- **[O] Live streaming of edits while the model is still generating.** This is the purpose of the `X-Wonder-Arg-Streaming: v1` header. The flow:
  1. The SDK runs with `includePartialMessages: true`. Main's `toolStreamTap` watches the `input_json_delta` stream events for `update_elements` and similar tools.
  2. As soon as `pageId` is parsed from the partial arguments, main creates `streamRef = "hstream-<uuid>"`. It asks a renderer over IPC `wonder:agent-tool-stream` (reply on `wonder:agent-tool-stream-reply`) with a `{kind:'begin', streamRef, pageId, sessionId, agentThreadId}` frame. It then forwards `{kind:'delta', seq, delta}` frames, then `{kind:'end', deltaCount}` or `{kind:'cancel'}`.
  3. The renderer (R `desktopShell-*`) relays these frames over its websocket as the operations `toolStream.begin`, `toolStream.delta`, `toolStream.end` and `toolStream.cancel`, scoped by `{organizationSlugOrId, fileId}`. The server renders the partial JSX into the canvas progressively.
  4. When the complete tool_use arrives, a PreToolUse hook (`redeemStreamedEdit`) rewrites the input to `{…input, edit: streamRef, pageId}`. The server then commits the already-streamed content instead of re-parsing it. If the stream was not accepted, the original input is sent unchanged.
- **[O] Other local tools reach the renderer through request/reply IPC pairs:**
  - `wonder:agent-preview-open-request/reply`
  - `wonder:agent-preview-capture-request/reply`
  - `wonder:agent-preview-published-request/reply`
  - `wonder:agent-terminal-open-request/reply`
- **[O] Agent presence.** Main emits the `canvas-session` and `canvas-sessions-released` events. The renderer mirrors the transcript to the server (`agentMirror.append`, `agentMirror.setStatus`), so collaborators and the web app can see the agent's chat and activity.

---

## 2. How the in-app chat runs agents

### 2.1 Claude: Agent SDK `query()`

The SDK is `@anthropic-ai/claude-agent-sdk` 0.3.293. **[O]** The options built in M `buildOptions`:

- **Executable and working directory**
  - `pathToClaudeCodeExecutable` points at the bundled `claude-code` runtime (from `Resources/agents/claude-code.tgz`, installed under userData `claude-runtime`). The process is spawned through `spawnClaudeCodeProcess`, and stderr is captured.
  - `cwd`:
    - a git worktree, under `~/wonder/workspaces/<repo>-<name>` or userData `worktrees`, for repo chats
    - `userData/agent-workdirs/<uuid>` for chats without a repo, which are "quick chats" (X: cwd, `isGitRepo:false`)
  - `additionalDirectories` holds attachment folders.
- **System prompt.** `systemPrompt: {type:'preset', preset:'claude_code', append: persona}`. The persona is assembled from T `persona/base` plus conditional rules: `dev-server-rule`, `files-allowed-rule` / `files-off-rule`, `auto-mode-rule`, `ask-user-rule`, `contained-rule*` and `background-command-rule`. Each MCP server also contributes `instructions`; the hosted `wonder` server's instructions repeat the persona's design rules.
- **Model, effort and modes**
  - `model`, unless the user picked "default".
  - `effort` is one of `low | medium | high | xhigh | max`. "Ultracode" forces the top level.
  - `settings: {autoCompactEnabled:true, fastMode, ultracode, workflowKeywordTriggerEnabled:false, disableClaudeAiConnectors?, attribution? (commit credit off → empty), permissions}`.
- **Streaming and limits.** `includePartialMessages: true`, `agentProgressSummaries: true`, `forwardSubagentText: true`, `maxTurns: 500`.
- **MCP servers.** `mcpServers = {wonder-shell, wonder-preferences, wonder-agents (SDK servers), wonder (http)}`. `strictMcpConfig` is set only against a local dev MCP.
- **Permissions**
  - `permissionMode` comes from the chat's access level (§2.4).
  - `allowDangerouslySkipPermissions` is true unless the chat is contained.
  - `canUseTool` routes to Wonder's permission card (`permission-request`, then `wonder:agent-respond-permission`).
- **Hooks**
  - `SessionStart`: re-injects persona, mode and containment on resume/compact/fork.
  - `UserPromptSubmit`
  - `Stop` / `SubagentStop`: scheduled checks.
  - `PreToolUse`: auto-allow Wonder tools, streamed-edit redemption, shell watching, keeping credentials out of searches, and review routing.
  - `PostToolUse`: reading published artifacts.
- **Resume and fork.** `{resume: token}` or `{resume, resumeSessionAt, forkSession:true}`. The session id is captured from `system/init` and persisted per chat. Context is reseeded when a resume is impossible (T `agents/chat-summary` produces a hand-off summary).
- **Model picker.** The list is dynamic: it comes from the SDK `initializationResult().models` (M `claude-models` reader). Codex models come from its app-server.

### 2.2 Codex

- **[O]** Runs `codex app-server [--config k=v …]` from the bundled `codex.tgz` and speaks JSON-RPC over stdio.
- **[O]** Methods: `initialize`, `thread/start` / `thread/resume` / `thread/fork`, `turn/start`, `turn/interrupt`, `review/start`, `config/read`, `config/value/write`.
- **[O]** `thread/start` params: `{cwd, approvalPolicy, sandbox, config:{mcp_servers:{…}}, model?, developerInstructions?, personality?}`. The developer instructions are the persona's `+codex` variants.
- **[O]** Codex items are mapped to the same event stream. Examples: `commandExecution` becomes a terminal step, and the item types `thread_spawn` and `unified_exec` are handled.

### 2.3 Events from main to the renderer

**[O]** One channel, `wonder:agent-event`. Each payload carries `{type, sessionId, seq, …}`. The types are:

- **Session lifecycle:** `session-init`, `session-ready`, `session-restarting`, `session-ended`
- **Turns:** `user-prompt`, `user-prompt-not-sent`, `turn-started`, `turn-complete`
- **Streamed text:** `assistant-text`, `assistant-text-delta`, `thinking`, `thinking-delta`
- **Tool calls:**
  - `tool-call` = `{toolCallId, toolName, input, title, kind, locations[{path}], parentToolCallId?}`
  - `tool-result` = `{toolCallId, content, isError}`
  - Read/search/list tools are grouped into a single title and kind.
- **Tasks and work:** `todo-list`, `task-updated`, `task-progress`, `background-work`, `terminal-step`
- **Requests to the user:** `permission-request` / `-resolved`, `question-request` / `-resolved` / `-auto-answered`, `run-config-proposal` / `-resolved` / `-auto-saved`
- **Session state:** `permission-mode-changed`, `mcp-servers`, `mcp-server-status`, `mcp-connection`, `agent-usage`, `agent-context`, `agent-models`, `agent-commands`, `compacting`, `context-recovery`
- **Canvas and code:** `canvas-session`, `canvas-sessions-released`, `code-snapshot`, `design-preference-changed`
- **Reviews and artifacts:** `review-launch`, `review-updated`, `artifact-version`, `artifacts-listed`
- **Errors and notices:** `agent-notice`, `error`, `containment-*`

### 2.4 Renderer → main IPC

**[O]** All channels are prefixed `wonder:`.

- **Running a chat:** `agent-start`, `agent-prompt` / `agent-submit-prompt`, `agent-interrupt` (calls `query.interrupt()` or Codex `turn/interrupt`), `agent-stop`, `agent-stop-task`
- **Answering cards:** `agent-respond-permission {sessionId, requestId, choiceId, note?}`, `agent-respond-question {requestId, answers}`, `agent-respond-run-config`
- **Session settings:** `agent-set-model`, `agent-set-effort`, `agent-set-fast-mode`, `agent-set-ultracode`, `agent-set-remote-control`
- **Watching and transcripts:** `agent-watch` / `unwatch`, `agent-get-transcript`
- **Queued follow-ups:** `agent-follow-up-*`, a queue of prompts sent while the agent is busy
- **Composer and memory:** `agent-draft-read` / `write`, `agent-memory-*`
- **Text catalog and preferences:** `agent-text-get` / `refresh`, `design-preferences-*`
- **Runtime and profiles:** `agent-runtime-install` / `read`, `claude-profile-*` (multiple Claude accounts)

### 2.5 Agent access levels

**[O]** The four levels map to Claude permission modes and to persona lines (T `hooks/permission-mode.*`). Codex uses the matching sandbox and approval policy. [I]

| Level  | Claude `permissionMode` | Persona says                                  |
| ------ | ----------------------- | --------------------------------------------- |
| `ask`  | `default`               | every edit and command needs approval         |
| `edit` | `acceptEdits`           | file edits are auto-approved, other tools ask |
| `auto` | `auto`                  | Claude Code's reviewer approves actions       |
| `full` | `bypassPermissions`     | everything runs without asking                |

Two separate controls sit beside the access level:

- **[O] Containment for chats that hold fork-PR code.** It overrides the mode, restricts writable roots and network hosts, and forbids preference writes.
- **[O] The Settings → Agents switch "agents may create files/pages".**

### 2.6 Attachments and per-turn context

**[O]** Each user turn is prefixed with a `<wonder-turn-context>` block. It contains an "Attached context:" list of rendered blocks (T `@template:blocks/*`). The blocks that matter for us:

- **`design-file`:** "Wonder design file "<name>" (fileId …). Read or edit it with the mcp__wonder__ tools."
- **`canvas-context`:** the pageId this conversation is pinned to, plus referenced node short ids. The agent is told to pass that pageId on every call.
- **`selection`:** the current selection's short ids, or a note that the selection is empty. Selection is sent **as ids only**; the agent fetches content with the tools.
- **`canvas-node`:** one referenced node, given as label + short id + pageId.
- **`images`:** pasted images are sent inline to the model **and** saved to disk under `userData/agent-attachments` (or `agent-worktree-attachments`), with their paths listed so the agent can `cp` the exact bytes.
- **Other blocks:**
  - `file`, `file-lines`, `folder`, `repo`, `worktree`, `worktree-files` (the Wonder files this chat may edit, read-only flagged)
  - `terminal`, `inspected-element`, `inspect` (Preview Inspect edits)
  - `figma.copied` / `figma.linked`
  - `chat-reference`, `referenced-chats`, `claude-artifact`
  - `design-preferences` (a `<saved-design-preferences>` list)
  - `agent-memory`, `shared-agent-memory` (e.g. the user's `~/.codex/AGENTS.md`)
  - `repository-instructions`

### 2.7 Quick chats, the question card and memory

- **[O] Quick chats.** The renderer shows a "Quick chats" sidebar group with "New quick chat". **[I]** These are repo-less chats that run in a scratch `agent-workdirs/<uuid>` cwd, matching transcript X.
- **[O] The question card.** `ask_user` takes 1–4 questions with 2–4 suggested answers each; the user can type or skip. Results come back paired as `Q1/A1`. In Auto mode, a question may be auto-answered with the "(Recommended)" option (`question-auto-answered`).
- **[O] Memory.** Claude Code's file memory is pointed at `userData/agent-memory/<orgId>/` and appears in the system prompt.

---

## 3. How agents read and write the canvas (document model as seen by tools)

### 3.1 Addressing

- **[O]** `pageId` is a UUIDv7.
- **[O]** Elements are addressed by **short `data-node-id`s**:
  - An artboard root gets a 3-letter word such as `ask`, `car` or `den`.
  - A descendant gets `<artboard>.<3 letters>`, such as `ask.mhz`.
- **[O]** Ids are unique only within a page. Long UUIDs (`nodeId=` in URLs) exist internally.
- **[O]** `data-node-label` is the human layer name.

### 3.2 Reading: serialization as Tailwind JSX

- **[O]** `get_element_code` returns JSX. Every element has `data-node-id`, `data-node-label` and `className` holding Tailwind classes. Arbitrary values are used freely (`w-[1384px]`, `text-[#1b1b1b]`, `[font-family:Manrope,_Inter,_sans-serif]`, `bg-[var(--color-accent)]`).
- **[O]** Artboard roots also carry `data-component-x/y` (canvas position) and, on create, `data-component-width/height`.
- **[O]** Text is the element's children. Icons are components (`<RiCloseLine size={28}/>` from react-icons, or `wonder-icons`). Images are `<img src>` or `bg-[url(…)]`.
- **[O]** Other read views:
  - `get_element_tree`: structure only
  - `get_artboards`: page overview with bounds and counts
  - `find_elements`: text/label search
  - `take_screenshot`: a raster of one node
- **[O]** The selection and pinned page arrive as ids in the turn context (§2.6). There is no automatic HTML or screenshot of the selection.

### 3.3 Writing: JSX create and a directive script

- **[O] `create_artboard`** takes `{pageId, code}`.
  - `code` may start with `import { … } from 'react-icons/fi' | 'wonder-icons'` lines, followed by one root element.
  - The root carries `data-node-label`, `data-component-width/height/x/y` and Tailwind classes.
  - `.map()` over inline arrays is allowed; the skill recommends it for repeated items.
  - The server assigns ids and returns the tree.
- **[O] `update_elements`** takes `{pageId, edit}`. `edit` is a sequence of comment-headed directives, each followed by JSX:
  - `{/* edit <id> */}` + one element: attributes/children patch, keeping the id. Used 54× in X.
  - `{/* replace <id> */}` + element: restructure in place. Used 9×.
  - `{/* insert as last child of <id> */}` / `as first child of` + element(s). Before/after forms are [I].
  - `{/* delete <id> */}`
  - The result reports per directive: `OK n. {directive}` plus the resulting JSX, `"N of M directives applied. K failed"`, and the ids removed or replaced.
- **[O] `duplicate_elements`** with `newArtboard:true` makes a variation beside the original. `propertyOverrides` and `count` are also accepted.
- **[O] Variables/tokens are document-level.** Token names use a slash hierarchy. Each token has `id: tok_<uuid>`, a `type` and a `cssVar`. Elements bind tokens by using `var(--…)` inside Tailwind arbitrary values. On the canvas, binding is stored as a token reference (R: `bindColorToken({nodeIds, target:{surface:'fill',index}, tokenId})`).
- **[I]** The server parses the JSX/Tailwind, maps it to Wonder node records (`pageNodes`, see `wonder-canvas-spec.md`) and writes the Yjs doc. The renderer lays the records out with its own HTML/CSS-like layout (flex, grid, block, absolute).
- **[O] Workflow the skills impose:**
  1. `get_design_context`
  2. `get_skills(<job>)`
  3. read (`get_element_code` / screenshot)
  4. write (`create_artboard` → skeleton first, then `update_elements` per section)
  5. `take_screenshot` to verify
  6. `finish_artboard`
  7. reply with the design link

---

## 4. Design system, export and code generation

1. **[O] Tokens.** CRUD through `*_design_tokens`. Agents must bind colors, sizes and fonts to tokens. Design-to-code must map Wonder `var(--x)` back to the repo's own token expressions, and must never ship `wonder-icons` imports or Wonder var names.
2. **[O] Icons.** A per-file icon library (`*_icons`), with `import { X } from 'wonder-icons'`. react-icons is the fallback, and emoji are banned.
3. **[O] Code to design and design to code are skill-driven. No server-side codegen tool exists.**
   - `get_element_code` JSX is the spec.
   - The agent edits the repo with its own file tools.
   - The prompt template `prompts/implement-design` uses URIs of the form `wonder://node/<org>/<pageId>/<elementId>` and tells the agent to call `get_element_code` + `get_skills('design-to-code')`.
4. **[O] "Apply to code" from the Preview.**
   - The user makes Inspect edits on the running app Preview (moved, restyled or rewritten elements).
   - `prompts/apply-preview` turns them into an agent prompt ("I moved N elements, changed …"), with `blocks/inspect`, `inspect.class` and `inspected-element` context.
   - `capture_preview` does the reverse: it turns the running app into an editable canvas design.
5. **[O] Editor actions callable by agents through `execute_action`.** The registry (R `command-actions-*`) holds about 100 actions, each with `{id, label, section, description, params:{name:{type, required, pattern/min/max…}}, isAvailable(ctx), execute}`. Examples:
   - align/distribute/tidy-up
   - `add-flex-layout`, `add-grid-layout`, `frame-selection`, `use-as-mask`
   - `apply-color-variable-to-selection {name}`, `apply-icon-to-selection {name}`
   - `set-page-background-color {color, alpha}`
   - `export-selection-png`, `export-selection-svg`, `copy-as-code`, `copy-as-png`
   - `create-page`, `create-folder {name}`, `move-file-to-folder {fileId, folderId}`, `read-files`, `read-folders`
   - zoom and theme actions
6. **[O] Export** is a user action (PNG/SVG; `copy-as-code` gives JSX/HTML). Agents read code through `get_element_code`, not through an export tool.
7. **[O] Design preferences** are stored locally, outside the document, and injected into every chat. They are writable only when the user states a lasting preference.

---

## 5. Parity gaps vs Verynize, in priority order

Today's state:

- `integrations/mcp-server.mjs` is a stdio server with 5 tools over JSON files, with no live sync.
- `desktop/agents.cjs` spawns `claude --print` / `codex exec` once per prompt.
- Selection, pinned page and streaming are absent.

### P0: live bridge between MCP and the open editor (the core gap)

1. **Architecture: the desktop main process becomes the MCP host.** Wonder's server-side Yjs is not needed. The renderer stays the source of truth for the open document. A file-backed fallback covers the case where no window is open.
   - Add `desktop/mcp-bridge.cjs`. It starts a **loopback Streamable-HTTP MCP server** (`@modelcontextprotocol/sdk` `McpServer` + `StreamableHTTPServerTransport`) on `127.0.0.1:<random>`. Require a per-launch bearer token. Write `{url, token}` to `~/Library/Application Support/Verynize/mcp.json` so external Claude Code/Codex can be configured to use it.
   - Each tool handler runs a request/reply IPC to the focused editor window: `bd:mcp-call {requestId, tool, args}` → `bd:mcp-reply {requestId, ok, result|error}`. Use a timeout, Wonder's `*-request/*-reply` pattern and an origin check.
   - If no editor window has the target document open, fall back to `integrations/design-store.mjs` (headless mode), and report `headless:true` the way Wonder does.
   - Keep `integrations/mcp-server.mjs` (stdio) as a thin **proxy** to the bridge when `mcp.json` exists. Otherwise it keeps the current file mode. Update its instructions text, which currently says edits are not live.
   - Add to `desktop/preload.cjs`: `onMcpCall(cb)` and `replyMcpCall(id, payload)`.
   - Add `web/agent-bridge.js`: a dispatcher that maps tool names onto `web/app.js` document operations. Every write goes through the existing undo/history path, so agent edits are undoable as one step per tool call.
2. **In-app agents get the bridge automatically.** In `desktop/agents.cjs` / `agent-settings.cjs`, pass `--mcp-config '{"mcpServers":{"verynize":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}'` to Claude, and `-c mcp_servers.verynize.url=…` to Codex. Auto-allow `mcp__verynize__*` with `--allowedTools`.

### P0: canvas tool set (names chosen for Wonder parity; schemas are ours)

All tools take `pageId`. Ids are short ids, unique per page: `<root>.<abc>`. Add a stable `shortId` to nodes in the document model; map it in `web/app.js` and `design-store.mjs`.

| Tool                                                                               | Input                                                                | Output                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_design_context`                                                               | `{pageId?}`                                                          | document/page list, current page, selection ids, open docs, tokens, icons, artboard summaries, guidelines text                                                                                |
| `get_artboards`                                                                    | `{pageId}`                                                           | `[{id,label,x,y,w,h,descendants,depth,children[]}]`                                                                                                                                           |
| `get_element_tree`                                                                 | `{pageId, ids[], depth?}`                                            | tag/id/label lines                                                                                                                                                                            |
| `get_element_code`                                                                 | `{pageId, ids[], depth?}`                                            | Tailwind-JSX per id. Write a serializer, `integrations/jsx-serialize.mjs`, that is shared with export.                                                                                        |
| `find_elements`                                                                    | `{pageId, scope?, queries[{query, match:['text','label']}], limit?}` | matches with ancestors                                                                                                                                                                        |
| `take_screenshot`                                                                  | `{pageId, id, scale?}`                                               | PNG via `desktop/render.cjs` (offscreen render of the node)                                                                                                                                   |
| `create_artboard`                                                                  | `{pageId, code}`                                                     | created tree with ids. Needs a **JSX/Tailwind → node parser** (`integrations/jsx-parse.mjs`) covering the subset `get_element_code` emits.                                                    |
| `update_elements`                                                                  | `{pageId, edit}`                                                     | directive script with `edit` / `replace` / `insert as first/last child of` / `insert before/after` / `delete`; per-directive report; atomic per directive                                     |
| `duplicate_elements`                                                               | `{pageId, id, newArtboard?, count?, overrides?}`                     | new ids/trees                                                                                                                                                                                 |
| `delete_elements`, `rename_elements`                                               | ids / `{id,label}[]`                                                 |                                                                                                                                                                                               |
| `get/create/update/delete_design_tokens`                                           | `tokens[{name:'color/x', type, value}]`                              | `{id, name, type, cssVar, value}`; replace today's hex-only `set_token` op                                                                                                                    |
| `bind_variables`                                                                   | `bindings[{id, property, token}]` (`token: null` unbinds)            | binds radius/gap/padding/strokeWidth/fontSize/letterSpacing/lineHeight/opacity/fontFamily/fontWeight to a typed token; token `type` may be color, dimension, number, fontFamily or fontWeight |
| `list_documents`, `open_document`, `create_document`, `create_page`, `rename_page` |                                                                      |                                                                                                                                                                                               |
| `execute_action`                                                                   | `{id, params?, paramsList?}`                                         | expose the existing command-palette actions (`web/ui.js`) with param schemas and `isAvailable`                                                                                                |
| `finish_artboard`                                                                  | `{pageId, id}`                                                       | select and zoom the node in the editor; return a `verynize://node/<doc>/<page>/<id>` link                                                                                                     |

Keep `apply_operations` (revision-checked batches) as the low-level escape hatch.

### Hosted MCP (implemented): server-side edits of shared rooms

Wonder's hosted server edits the shared document on the server and open tabs follow through collaborative sync (§1.3). Verynize's equivalent is `POST /api/mcp` on the collaboration Worker (`cloud/mcp.js`, documented in `cloud/README.md` › Hosted MCP). It serves the shared tool table of `integrations/design-tools.mjs` (31 of its tools; screenshots, `ask_agent`, `import_html`, `export_document`, preferences and shell tools are absent) over the account's cloud rooms, authenticated by a Verynize session bearer token. Edits become server-sequenced room operations (`DesignRoom.agentApply`) that open editors receive as ordinary `ops` messages; results report `headless: true`. Differences from Wonder: no OAuth (clients send `Authorization: Bearer <token>`), no argument streaming, no screenshots, and rooms are addressed by id instead of file/branch.

### P1: per-turn context and chat runtime

3. **Turn-context block.** `web/app.js` adds a context prefix to every prompt: the document name and path, the pinned pageId, the selection short ids, and the paths of any pasted images. Save pasted images to `userData/agent-attachments/<chat>/` and send their paths. The content itself stays behind tools, as in Wonder.
4. **Replace one-shot spawning with the Claude Agent SDK `query()`** in a new `desktop/agent-session.cjs`:
   - streaming input (`AsyncIterable` prompts) so follow-ups and interrupts work
   - `includePartialMessages`
   - `systemPrompt:{type:'preset', preset:'claude_code', append: <our persona>}`
   - `mcpServers` for the bridge, plus the in-process `createSdkMcpServer` tools `ask_user` and design preferences
   - the `canUseTool` permission card
   - `resume` with the stored session id
   - `interrupt()`
   - the model list from `supportedModels()` / `initializationResult()`

   For Codex, use `codex app-server` JSON-RPC (`thread/start` → `turn/start`, `turn/interrupt`, `thread/resume`).

5. **Unified event stream** to the renderer over `desktop:agent-event`. Use typed events: `session-init`, `turn-started`, `assistant-text-delta`, `thinking-delta`, `tool-call {toolCallId, toolName, input, title, kind}`, `tool-result`, `permission-request`, `question-request`, `turn-complete`, `error`. Render tool calls as collapsible rows, grouped read/search, with a design-link chip for `finish_artboard`.
6. **Access levels.** Use Wonder's four levels: Ask→`default`, Edit→`acceptEdits`, Auto→`auto`, Full→`bypassPermissions`. For Codex, map Ask→`untrusted`+read-only and Full→`never`+`danger-full-access` [I]. Replace the current `ask | read-only | workspace-write` set. Add a "agents may create files/pages" toggle that sets `disallowedTools`.
7. **Quick chats.** Repo-less chats with a scratch cwd under `userData/agent-workdirs/<uuid>`.

### P2: streaming and polish

8. **Streamed canvas edits.** Watch `input_json_delta` for `create_artboard` / `update_elements`. Once the parse is far enough, forward complete top-level elements to the renderer as a **ghost preview**, then commit on the real tool call. Simplest version: no `streamRef` redemption; the final call replaces the ghost.
9. **Skills and guidelines.** Add `get_skills(name)` serving our own markdown playbooks (new-design, edit-design, design-to-code, code-to-design, design-library) from `integrations/skills/`. Add `get_design_guidelines`. These must be written fresh; do not copy Wonder's.
   - _Status (2026-10-31):_ implemented, but in `integrations/design-knowledge/` (not `integrations/skills/`): skills are JavaScript modules in `skills.mjs` (12 skills, `variations` and `design-system` as aliases), fundamentals in `fundamentals.mjs`, 31 named styles in `styles/`. Served by `get_skills` and `get_design_guidelines` in `integrations/design-tools.mjs`. See `docs/design-harness.md`.
10. **Design preferences.** A local store plus a `<saved-design-preferences>` block, with save/update/delete tools gated on explicit user intent.

- _Status (2026-10-31):_ implemented. Store `integrations/preferences.mjs` (50 × 280), block and gate in `desktop/agent-runtime.cjs` / `desktop/agent-access.cjs`: Claude SDK asks for every write, Ask/plan-first/helper/CLI-fallback runs refuse, Codex app-server Edit/Auto/Full chats rely on the persona rule. See `docs/agent-workflows.md`.

11. **Assets.** `prepare_image_upload` equivalent (a local `import_image {pageId, path}` is simpler on desktop), plus `generate_image` / `vectorize_image` via `desktop/generate.cjs`.
12. **Code bridge.** An "Implement this design" action that builds a prompt with `verynize://node/…` URIs, plus a Preview "apply inspect edits" prompt (`desktop/preview.cjs` / `web/live-preview.js`).

### Unknowns worth probing later (needs Wonder auth, so not done)

- **[U]** Exact JSON schemas and descriptions of the hosted tools (served by `tools/list` after OAuth).
- **[U]** Exact `update_elements` grammar for before/after inserts and multi-root inserts.
- **[U]** How `execute_action` is executed server-side for renderer-only actions. It may be relayed to an open tab, since the error text mentions "the tab reconnected".
- **[U]** The parameters of `generate_image`, `generate_svg` and `vectorize_image`.
