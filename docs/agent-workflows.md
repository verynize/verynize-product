# Local agent workspace

The chat panel (docked transcript, model picker, access levels, attachments and quick chats) runs local agent runtimes. Claude can use the machine’s Claude Code login; Codex uses Verynize’s separate Sign in with ChatGPT connection, described below. The behavior follows `docs/wonder-ai-mcp-spec.md` §2; the code and all prompt text are our own.

## Runtime

`desktop/agent-runtime.cjs` owns chat turns. `desktop/main.cjs` registers it with `registerAgentRuntime(handle, win, {userData, getProject})`.

- **Claude** uses `@anthropic-ai/claude-agent-sdk` `query()`. `pathToClaudeCodeExecutable` points at the discovered `claude`, so the user's Claude Code install and login are used; if Claude Code is missing, the SDK's bundled runtime is used. Options:
  - `systemPrompt: {type:'preset', preset:'claude_code', append: <Verynize persona>}`
  - `includePartialMessages: true`, which streams text, thinking and tool-argument deltas
  - `resume: <sessionId>` to continue a conversation
  - `permissionMode` from the access level
  - `mcpServers` (described below)
  - `canUseTool`, which routes approval prompts to the chat
  
  The prompt is a streaming-input iterable that stays open until the turn's `result` arrives, so `Query.interrupt()` works for **Stop**. Pasted images go inline as base64 image blocks, and their saved paths are also listed in the context block. If the SDK cannot be loaded, the runtime falls back to `claude --print --output-format stream-json --include-partial-messages` with `--resume`, `--append-system-prompt` and `--mcp-config`.
- **Codex** uses `codex app-server` JSON-RPC when `codex app-server --help` succeeds. The SIWC transport is verified against codex-cli 0.166 with a local Responses server. The protocol flow:
  1. `initialize`, then `initialized`
  2. Check/refresh the selected local SIWC credential before starting a thread (the CLI account is unrelated)
  3. `thread/start`, or `thread/resume` when the chat has a thread id (a failed resume starts a fresh thread)
  4. `turn/start` with text plus `localImage` inputs and `model`/`effort`
  5. `turn/interrupt` for **Stop**
  
  One app-server process per account serves every chat thread of that account.

  **Desktop authentication: Sign in with ChatGPT (SIWC).** `desktop/chatgpt-auth.cjs` owns the public-client flow for this MIT-licensed local app. New registrations use `dynamic_agent_client`, `agent_name_hint=Verynize`, a stable per-installation `ext_agent_host_id`, a random loopback port on `127.0.0.1`, fresh state/nonce and PKCE S256. The issued client ID is saved only after code exchange and RSA/JWKS verification of issuer, audience, expiry, nonce and account subject. Returning sign-in reuses the issued client ID and validates the selected identity before replacing tokens. The existing terminal/Codex-app login is separate; users connect once through **Continue with ChatGPT** in onboarding, Settings › Accounts/Agents, or the chat sign-in card. Old CLI tokens are never imported.

  Credentials live only in the Electron main process and owner-only local files: `userData/chatgpt/account.json` for the built-in account, `userData/agent-profiles/codex/<id>/chatgpt.json` for named accounts, and `userData/chatgpt/host.json` for the stable host identifier. Status IPC returns display metadata only. Access tokens go only into the app-server child environment (`VERYNIZE_CHATGPT_ACCESS_TOKEN`), never argv. App-server uses `model_provider=openai_chatgpt_plan`, `base_url=https://api.openai.com/v1`, `wire_api=responses`, `requires_openai_auth=false`, and `supports_websockets=false`. `initialize.clientInfo.name` is `Verynize`, matching registration. No separate `codex login` or client secret is used. A recent Codex CLI with app-server is required; SIWC never falls back to the old exec/login route.

  Before each turn/server launch, expired or nearly expired access tokens are refreshed. Rotating refreshes are serialized per registration in memory and with local filesystem locks across processes. The child is restarted with the renewed token before the next idle turn, retaining its thread ID for resume. Logout immediately stops account threads, attempts renewable-session revocation with a bounded retry, clears local access/refresh/ID tokens and keeps the client/subject/host mapping. If revocation cannot be confirmed, the UI tells the user to disconnect Verynize in ChatGPT Settings → Usage. Removing a named account also attempts revocation before deleting its folder.

  Signed-out/revoked credentials produce one `auth-required` card without starting a thread or turn; HTTP 401 during a turn uses the same card. Titles and user-triggered helpers use the default SIWC registration. Model lists are a client catalog, not an entitlement check. Existing SIWC threads resume normally; a legacy thread rejected after the provider change starts a new SIWC thread seeded from available user/assistant history. The displayed transcript stays intact.

  SIWC does not support hosted connectors, native Computer Use, image generation, or Responses `tool_search`. The desktop disables ChatGPT apps and Computer Use switches for this connection; local canvas and MCP tools still run through supported tool calls. Settings hide Codex tools, usage, personality, memory, model choices and saved permission groups until at least one local SIWC registration is connected. Connection entry points stay visible. Hiding is a renderer filter: Codex configuration files, tools and permission rules are retained and reappear after connection. Usage shows only connected Codex registrations, including named accounts. Plan access remains free in Verynize and subject to the user's eligible ChatGPT plan and limits. The first connection shows a local privacy notice and a one-time plan confirmation. The composer and Settings › Usage link to `https://chatgpt.com/settings/usage`.

  Official contracts: [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [refresh and logout](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [app-server provider](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

- **Quick chats** are chats with no repository. They run in a per-chat scratch directory, `userData/agent-workdirs/<chatId>`. **Repository chats** (Code workspace) each run in their own git worktree, `<Verynize folder>/workspaces/<repo>/<name>` (default `~/Verynize`) on branch `<prefix>/<name>` (the Settings › Agents branch prefix, else the GitHub username, else `verynize`; see `desktop/repositories.cjs`); the renderer passes the chat's folder as `runAgent({root})` and main validates it against the repository registry. Folders without a commit, and chats saved before worktrees existed, run in the repository root. Project memory (`VERYNIZE.md`) and the user's personal instructions are appended to the persona: Claude's `append`, or Codex's `developerInstructions`. Claude chats also get `~/.codex/AGENTS.md` (Codex reads it itself; skipped when `~/.claude/CLAUDE.md` has the same text or imports it). Claude quick chats share one auto-memory folder, `userData/agent-memory/<id>`, passed as the `autoMemoryDirectory` flag setting (`desktop/agent-memory.cjs`); repository chats keep Claude Code's per-repository memory. The CLI fallback does not pass it.
- At most three turns run per window, and only one per chat.

## Access levels

| Level | Claude `permissionMode` | Codex `approvalPolicy` / `sandbox` |
|---|---|---|
| Ask | `default` (each tool prompt becomes an approval card) | `untrusted` / `read-only` |
| Edit | `acceptEdits` | `on-request` / `workspace-write` |
| Auto | `auto` | `on-request` / `workspace-write`, `approvalsReviewer: auto_review` |
| Full | `bypassPermissions` (+ `allowDangerouslySkipPermissions`) | `never` / `danger-full-access` |

Older saved defaults map forward: `read-only` becomes Ask and `workspace-write` becomes Edit. An unanswered approval card is denied after 10 minutes, and when the turn ends.

## Access switches (Settings › Agents › Access)

`desktop/agent-access.cjs` stores eight switches in `userData/agent-access.json`. The runtime reads them at the start of every turn, so changes apply when a chat's agent next starts.

| Switch (default) | Effect |
|---|---|
| Create files, folders and pages (on) | Persona tells the agent to create what it needs. Off: the persona says to ask first, and Claude gets a `PreToolUse` hook that raises an approval card for `Write`/`NotebookEdit` on a new path, `mkdir`/`touch`, and `create_page`/`create_document` (except at Full access). Codex gets the persona instruction only. |
| Share memory (on) | The other agent's files are appended to the persona: for Claude, `~/.codex/AGENTS.md`, the project `AGENTS.md` and `~/.codex/memories/*.md`; for Codex, `~/.claude/CLAUDE.md`, the project `CLAUDE.md` and Claude's auto memory `~/.claude/projects/<slug>/memory/MEMORY.md`. Bounded to 12,000 characters. |
| Ask other agents (off) | Gates the `ask_agent` canvas tool: `primaryRuntime.askTool()` refuses while off, Claude gets `disallowedTools: mcp__verynize__ask_agent`, Codex gets `-c mcp_servers.verynize.disabled_tools=["ask_agent"]`. The user's own **Second opinion** action is not affected. |
| Claude connectors (on) | Off: `ENABLE_CLAUDEAI_MCP_SERVERS=false` in the Claude child environment. |
| Claude artifacts (on) | Off: `CLAUDE_CODE_DISABLE_ARTIFACT=1` and `disallowedTools` `Artifact`, `ArtifactComments`, `ArtifactData`, `ArtifactCheck`. |
| Chrome in Claude chats (off) | SDK `extraArgs` `--chrome` / `--no-chrome` (CLI fallback gets the same flag). |
| ChatGPT apps in Codex | Disabled for SIWC; hosted connectors are unsupported. |
| Computer Use in Codex | Disabled for SIWC; local canvas/MCP tools remain available. |

The Codex app-server is keyed by its launch flags, so a changed switch starts a fresh server once no Codex chat is running on the old one. Flag names were checked against Claude Code 2.1.308 (`claude --help`, binary strings) and codex-cli 0.165 (`codex features list`, `codex app-server --print-startup-config`).

## Settings › Agents behaviour

`desktop/agent-behavior.cjs` stores the lower half of Settings › Agents (`userData/agent-behavior.json`) and the runtime reads it per run:
- **Follow-up messages** (Steer | Queue, default Queue): while a turn runs, Send goes the default way and ⌘↵ the other way (`web/desktop-panel.js`). A steer the runtime cannot take falls back to the queue.
- **Expand agent work by default**: turn headers, tool groups and tool calls render unfolded (`web/src/islands/chat/transcript.tsx`).
- **Claude response style**: "Use my Claude Code setting" sends nothing; a chosen style is SDK `settings.outputStyle`. **Codex personality** None sends `personality:"none"` on `thread/start` (new chats only).
- **Credit the agent** off sends Claude `settings.attribution = {commit:'', pr:''}` (and `includeCoAuthoredBy:false`). Codex follows its own (ChatGPT) setting.
- **Mode for new chats**: the Default row is the chat defaults' access (the same value as Default Models › Access); a repository's own pick is stored per repository id and applied as `chat.access` when a new chat starts there. The composer's mode picker then changes that chat only.
- **Allowed without asking** lists and removes Verynize, Claude Code and Codex rules (see `desktop/README.md`).

## Per-turn context

Each prompt is prefixed with a `<verynize-context>` block. When **Send canvas context** is on, it holds:
- the open document's name, its library id and its saved path
- the active page name and `pageId`
- the selected element **ids only**
- the paths of attached images

Image paths are accepted only under `userData/agent-attachments/<chatId>/`. Pasted or picked images are saved there by `saveAgentImage`, after their magic bytes are checked against PNG, JPEG, GIF and WebP. The persona tells the agent to fetch content through the `verynize` MCP tools and to pass the given `pageId`.

**Design style.** `runAgent({designStyle})` carries the style the user picked with the `/style` slash command (menu `#chat-style-menu`; the composer has no style chip) or a starter brief with a style (see `docs/design-harness.md`). `normalizeDesignStyle` accepts a slug matching `/^[a-z0-9-]{1,40}$/`; anything else rejects the run, and an empty value means none. The context block then gets one line telling the agent to load that style with `get_design_guidelines {style: "<slug>"}` before designing and to follow it unless the user asks otherwise. A run with a style gets the block even without other context. `designStylesList()` (IPC, preload `window.desktop.designStylesList`) returns `[{id, name, summary}]` from `integrations/design-knowledge/styles/index.mjs` `listStyles()`, loaded lazily; it returns `[]` when the library is missing or fails, and the picker then stays hidden.

## Design preferences and refusals

Every chat's persona ends its runtime section with a `<saved-design-preferences>` block built from `integrations/preferences.mjs` (`userData/design-preferences.json`): `[id] text` items framed as the user's taste for visual work, which the current request overrides, or an explicit empty state. Both say the block supersedes older copies in the conversation. Limits are 50 preferences of 280 characters, shared by the store, the block and the `designPreferences*` IPC validator.

Agent writes (`save_design_preference`, `update_design_preference`, `delete_design_preference`) are gated by `agentAccess.preferenceWritePolicy`; `list_design_preferences` is never gated.
- **approve** (Edit/Auto/Full chats that can show approval cards): Claude SDK chats get a `PreToolUse` hook that raises an approval card for every call. Saved "always allow" rules and autonomy/Settings › Tools allow defaults do not skip it, and the card offers no "always allow". A decline is denied with `PREFERENCE_DECLINED_REASON`. Codex app-server chats rely on the persona rule (writes only on the user's explicit word), since Codex has no per-tool approval hook for MCP tools.
- **blocked** (Ask access, plan-first chats, helper runs, the Claude CLI and `codex exec` fallbacks): Claude's hook denies with `PREFERENCE_BLOCKED_REASON`, the CLI gets `--disallowedTools`, Codex threads get `mcp_servers.verynize.disabled_tools` in their thread config (with `ask_agent` when that switch is off), `codex exec` gets the same as a `-c` flag, and helpers have the tools in `HELPER_BLOCKED_DESIGN_TOOLS`. The persona says the list is read-only and points to Settings › Memory.

Both persona variants are followed by `REFUSAL_LINE` (`desktop/agent-access.cjs`): when a tool refuses a call (a limit, a missing permission, a declined approval or a mode that does not allow it), the agent tells the user plainly what was refused and why, and does not repeat the same call. The designer persona (`integrations/design-knowledge/persona.mjs`, rule 7) says the same. Tests: `node --test tests/agent-runtime.cjs` (block, limits, validator, gate per runtime and access, `designStyle`).

## Composer "+" menu and slash commands

- **+ menu** (`web/src/islands/chat/attach-menu.tsx`): *Add to this worktree* copies picked files or a folder into the chat's worktree (`worktreeAddFiles`, never overwriting, folders without `.git`/`node_modules`) and *Link a chat or worktree* lists the chats of every repository: linking one attaches its transcript as `<linked-chat>` and adds its worktree as a working directory; *New worktree* creates a fresh worktree of the current repository and links it. *Attach to this message*: files and images, the recent output of the Code workspace terminal (`terminalRecentOutput`, sent as `<terminal-output>`), a Figma link, and *Design references*: saved image collections in `userData/design-references/` (`designReferences*`; *Save attached as a collection* stores the attached images). *Commands* opens the slash-command list.
- **Working directories** (`/add-dir`, linked worktrees) are stored per chat and sent as `runAgent({directories})`: Claude `additionalDirectories`, Codex `sandbox_workspace_write.writable_roots`, and a line in the turn context.
- **Slash commands** (`slash-commands.tsx`, `desktop/agent-commands.cjs`): "/" at the start of the prompt lists Verynize's own commands (run in the app: `/add-dir`, `/add-file`, `/clear` = fresh provider session, `/canvas-context`, `/attach-canvas`, `/open-file`, `/review-changes`, `/apply-design`) and the agent's: for Claude the SDK's `supportedCommands()` / init `slash_commands` plus `~/.claude/commands`, `~/.claude/skills` and the chat folder's `.claude/…`; for Codex `~/.codex/prompts` (as `prompts:name`) and `~/.codex/skills`. A sent `/name args` reaches Claude as typed (no context preamble, so Claude Code runs it); for Codex the runtime expands custom prompts (`$ARGUMENTS`, `$1`…`$9`, `$$`) and skills before the turn.

## MCP bridge

`desktop/mcp-bridge.cjs` exposes `getBridgeInfo() -> {url, token}` for the loopback Streamable HTTP server. The runtime loads it lazily with `require` inside `try`, so chat keeps working without it.
- **Claude** gets `mcpServers['verynize'] = {type:'http', url, headers:{Authorization:'Bearer …'}}` and `allowedTools: ['mcp__verynize__*']`.
- **Codex** gets `-c mcp_servers.verynize.url="…"` and `-c mcp_servers.verynize.bearer_token_env_var="VERYNIZE_MCP_TOKEN"`. The token goes in the child environment, never in argv.

Only loopback URLs are wired.

### Component tools

Agent edits are versioned per artboard (docs/version-history.md): when an agent starts editing an artboard the person (or another editor) worked on, their state is stored as a version first; bridge commits run inside `window.versionHistory.as({kind: 'agent'})`, headless writes record the sidecar `NAME.verynize.history/` and hosted edits are agent batches in the room. `finish_artboard` stores a milestone. `list_versions` and `restore_version` (one undoable edit that stores the replaced state first; `asCopy` adds a copy) work on every backend; `restore_version` counts as a canvas edit (`MUTATING_DESIGN_TOOLS`) and is blocked for read-only helpers.

`list_components`, `create_component`, `create_instance`, `detach_instance`, `reset_overrides` and `set_slot` (`integrations/design-tools.mjs`) wrap the shared engine in `web/component-core.js`; the spec is `design/component-audit/README.md`. Each call is one `transact`, so the bridge applies it as one undo step and the file backend writes it once. Every agent write runs the shared sync headless before it reaches the canvas: keys an agent changes on instance layers become overrides, except the layout the headless reflow writes (flow positions, `measured`); instances the sync changed are laid out again. The component commands re-sync themselves and mark nothing. The JSX codec writes `data-component`, `data-instance-of` (the main's short id, or its long id when it is on another page) and `data-slot` (+ `data-slot-state` inside instances); a new element with `data-instance-of` is materialized from its main, and its `data-slot` descendants fill the slots by name. `update_elements` reports layers added to or deleted from an instance outside its slots as `notes:` (not codec warnings, so they do not block `finish_artboard`). The agent guide is the `components` skill. The component tools count as canvas edits for the finish hook and are blocked for read-only helpers (`MUTATING_DESIGN_TOOLS`). Tests: `node --test integrations/component-tools.test.mjs`.

### Shell tools and access levels

The bridge also serves bridge-only shell tools: `get_dev_server`, `start_dev_server`, `stop_dev_server`, `configure_dev_server`, `preview_open`, `preview_snapshot`, `preview_screenshot`, `preview_click`, `preview_type`, `preview_scroll`, `preview_console`, `capture_preview_to_canvas`, `run_terminal_command`, `read_terminal` and `execute_action`. They are described in `desktop/README.md`. The stdio server without the app answers them with a "needs the desktop app" error.

Exec tools (start/configure dev server, terminal commands) follow the chat's access level when the request carries `x-verynize-access`:
- `auto` and `full` run them without asking.
- `ask` and `edit` show a native approval dialog.
- `readonly` (helper agents) refuses every tool that changes the app or runs something.

Requests without the header are treated like Ask. The runtime does not send this header yet, so every in-app chat currently gets the approval dialog for exec tools. Two follow-ups for `desktop/agent-runtime.cjs` / `agent-settings.cjs`:
- add the header to `claudeMcpServer()` headers and to the Codex MCP config, set per access level
- add the shell tools to `HELPER_BLOCKED_DESIGN_TOOLS` or send `readonly` for `ask_agent` helpers

Until then, the read-only helper is protected only by the approval dialog. `VERYNIZE_SHELL_EXEC=0` or `setBridgeOptions({shellExec:false})` turns exec tools off entirely.

## Events and UI

Main sends typed events on `desktop:agent-event`. Each one has `{id, chatId, seq, type}`. The types are:
- `session`, `status`
- `assistant-text-delta`, `assistant-text`, `thinking-delta`
- `tool-call`, `tool-input-delta`, `tool-result`
- `permission-request`, `permission-resolved`
- `usage`, `error`
- `auth-required {agent, text, account}` (at most one per run; later errors of the run are dropped)
- `done {code, stopped, sessionId, resumeAt?}`. `resumeAt` is the fork point of the finished turn: Claude's last main-chain transcript entry uuid, or the Codex turn id.

Translators live in `desktop/agent-runtime-events.cjs`, one each for SDK messages, app-server notifications and `exec --json` lines. The renderer (`web/desktop-panel.js`) handles them as follows:
- It streams text and re-renders only the active reply, at most once per frame.
- `auth-required` becomes one **Sign in to Codex** card (`web/src/islands/chat/auth-card.tsx`, classes `.chat-auth`, `.chat-auth-signin`, `.chat-auth-retry`). Its **Continue with ChatGPT** button starts Verynize’s SIWC browser sign-in for the run’s account (`startAgentLogin`, the Settings › Accounts flow); when the sign-in completes (from the card or anywhere else) the card offers **Retry**, which resends the message in place of the signed-out reply.
- Thinking shows in a collapsible block. Tool calls show as collapsible cards with input (partial JSON while streaming) and result. Permission requests show as Allow/Deny cards.
- **Stop** interrupts the turn.
- Each conversation stores the provider `sessionId`. A follow-up with the same agent in the same project passes `sessionId` to resume the native session, and the saved transcript is not re-sent. Switching agents, or **Continue from here** (a transcript branch), starts a new session seeded with the last eight messages. Files are never reverted.
- **Rewind** (Restore / Rewind to here, Retry, Edit) truncates the chat before a user message. Each reply stores `resumePoint {sessionId, at}` from its `done` event, so the next turn passes `fork: {sessionId, at}` for the last kept reply. Claude resumes a forked copy of the session cut there (`resume` + `resumeSessionAt` + `forkSession`), after checking with `getSessionMessages` that the entry exists. Codex calls `thread/fork` with `lastTurnId`. If the fork point is missing or refused, the transcript `seed` sent with it is used instead. The canvas is restored only when a canvas checkpoint exists. Files are not reverted.
- **Second opinion** (a reply action) sends the reply, the user request before it, and the project's `git status --short` and `git diff HEAD` to the other provider through `reviewAgent`. It runs as the read-only helper used by `ask_agent`: Claude gets only Read/Glob/Grep, and Codex gets a `read-only` sandbox, `never` approvals and canvas edit tools disabled. If the other provider is not installed, the installed one answers. The review is added to the chat as a separate assistant message.
- The model field is free text, with suggestions from Claude `supportedModels()` or Codex `model/list`.

Transcripts, including tool and permission parts, persist per project in `localStorage`. Runs that were in progress when the app closed are shown as interrupted when reloaded.

Chat usage counters are local task counts. Settings › Usage reads the accounts' real plan limits (`desktop/agent-usage.cjs`): Claude through the SDK's structured `/usage` data, Codex through `account/rateLimits/read`; `node --test tests/agent-usage-memory.cjs` covers parsing, the app-server exchange (fake), layer counting and memory discovery against temp folders.

## Verification

- `node --test tests/agent-options.cjs` checks:
  - the access-level mapping
  - the fallback argv, including resume, MCP config and the token kept out of argv
  - the fallback runner's typed events, using a real temporary executable
- `node --test tests/agent-runtime.cjs` checks:
  - the context block and the persona
  - the SDK options
  - the Claude runtime against a scripted fake `query()`: streaming, tool cards, the Ask-mode permission round-trip, MCP headers, inline images, resume and interrupt
  - the Codex runtime against `tests/fixtures/fake-codex.cjs`: app-server JSON-RPC, approvals, MCP `-c` flags and env token, resume, a missing thread, interrupt and `model/list`
  - the exec fallback
  
  It also has a real Claude smoke test, which runs only with `VERYNIZE_REAL_AGENT_SMOKE=1`.
- `node --test tests/codex-sign-in.cjs` checks the sign-in gate against the fake Codex (`$CODEX_HOME/fake-account.json` is its `account/read` answer): signed out → no thread/turn, one `auth-required`, no error; the signed-in cache and its invalidation; a 401 mid-turn → one event, turn interrupted, no retry lines; the exec fallback's `codex login status` gate; and `account/read` display accounts. Its last case runs the real installed `codex` with an empty temporary `CODEX_HOME` (signed out, no turn; skipped without Codex).
- `node --test tests/chatgpt-auth.cjs` runs a real local OAuth server with PKCE and signed ID tokens, validates state/nonce/issuer/audience/signature/expiry/consent/account binding, checks rotating refreshes across stores, isolated named accounts, cancellation and revocation failures, and runs the installed Codex CLI against a local Responses HTTP endpoint without a real account or model request.
- `node tests/codex-sign-in-ui.cjs` (Electron): a signed-out Codex chat (real `codex` with an empty temporary `CODEX_HOME` when installed) shows exactly one sign-in card with a Sign in button and no raw error; signing in through the card (SIWC against the local OAuth provider) and Retry send the message once. It never touches `~/.codex`.
- `node tests/agent-chat.cjs` drives Electron against the fake Codex app-server. It covers:
  - a quick chat in a scratch folder
  - streaming and tool cards
  - the context block
  - a project chat that resumes its session
  - the approval card
  - Stop
  - branching, docking and persistence

No test calls a real model unless the smoke flag is set.

`BD_LIVE_AGENTS=1 node --test tests/agent-runtime-live.cjs` runs one real turn per installed provider through the runtime module. Each turn uses Ask access, a small model, low effort and a temporary quick-chat folder. The test checks the event shape, streamed text, usage and `resumeAt`. It also starts a throwaway loopback MCP server and checks that the provider connected with the bearer token and listed its tool. Fork points are checked without a model call. Set `BD_LIVE_AGENTS_REWIND=1` to also run one forked turn per provider, or set `BD_LIVE_AGENTS_ONLY=claude|codex` to test only one provider.

## Documentation

- Claude Agent SDK, checked through Context7 (`/websites/code_claude_en_agent-sdk`): `Options`, `PermissionMode`, `mcpServers` HTTP headers, `includePartialMessages`, `resume`. Also checked against the installed `sdk.d.ts` (0.3.312): `pathToClaudeCodeExecutable`, `canUseTool`, `interrupt()`, `supportedModels()`, `close()`.
- Codex app-server: `codex app-server generate-ts`, for `ThreadStartParams`, `TurnStartParams`, `TurnInterruptParams`, `ServerNotification` and `ServerRequest`.

## Accounts, tools and autonomy

- **Accounts** (Settings › Accounts, `desktop/agent-profiles.cjs`): besides "This Mac", any number of named accounts per provider. Each keeps its own login in a private folder (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). The account a run uses is the chat's pick (Autonomy panel), else the provider default. Codex runs one app-server per account. Settings › Usage shows one card per named account. Claude sign-in launches its installed CLI with the account folder; Codex uses Verynize’s SIWC browser flow and stores its registration alongside the profile. Tests use a local OAuth provider; an actual OpenAI account login still requires interactive consent.
- **Tools** (Settings › Tools, `desktop/agent-tool-config.cjs`): Verynize-managed MCP servers (stdio or HTTP, global or per project) are added to Claude's `mcpServers` and to Codex as `-c mcp_servers.<name>.*` overrides; permission defaults become Claude `allowedTools`/`disallowedTools` and are applied to approval requests of both agents.
- **Autonomy** (composer gauge button, `desktop/agent-autonomy.cjs`): per chat access level, account, allowed/denied tools, auto-approve rules (`Tool: text`), max turns (Claude `maxTurns`; Codex tool steps), budget (Claude `maxBudgetUsd`; both stop on a reported cost over it) and plan before edits (Claude `permissionMode: 'plan'`; Codex read-only sandbox + `untrusted` approvals + a persona instruction). A customised run starts with an `autonomy` transcript line; automatic decisions appear as `policy` lines.
- Tests: `node --test tests/agent-accounts-tools.cjs`, `node --test tests/workspace-search-moves.cjs`, `node tests/agent-workspace-ui.cjs`.
