// Chat transcript (29, 36, 37, 51): user bubbles, "Wondered for 18s" thinking rows, Markdown replies,
// tool-call cards, permission cards. Keeps the test contract classes: .chat-message(.user|.assistant),
// .chat-tool > summary, .chat-thinking, .chat-permission-allow/-deny, .chat-error.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  GaugeIcon,
  ShieldOffIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FrameIcon,
  HistoryIcon,
  PencilIcon,
  RotateCcwIcon,
  ScaleIcon,
  CircleDotIcon,
  CircleAlertIcon,
  FileIcon,
  FilePenIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  ImageIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  ShieldXIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { LogoIcon } from "@/components/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { legacySet } from "@/lib/bridge";
import { platform } from "@/lib/platform";
import { cn, textOf } from "@/lib/utils";
import { AuthCard } from "./auth-card";
import { ChatActionButton, ChatIconButton, ChatPillButton, ChatSuggestionButton } from "./controls";
import { Markdown, openAppLink } from "./markdown";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuItem,
  ChatMenuNote,
  ChatMenuSeparator,
  ChatMenuTrigger,
} from "./menu";
import { MentionIcon } from "./mention-popover";
import { PREVIEW_SETUP_REQUEST, PreviewSavedCard, savedPreview } from "./preview-setup";
import { QuestionCard } from "./question-card";
import { ChatTip } from "./tip";
import { usageSummary } from "./usage-ring";
import { useAdopt } from "./adopt";
import { useChatBehavior } from "./behavior";
import { hook, stateHook } from "./hooks";
import { useNow, workspace, type ChatMessage, type ChatPart, type ChatState } from "./store";

const pretty = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
const seconds = (from?: number, to?: number) =>
  Math.max(1, Math.round(((to ?? from ?? 0) - (from ?? 0)) / 1000));

/** Wonder's 3×3 dot grid: "Wondering…" marker while a turn runs (37, 39). */
function DotGrid({ live, className }: { live?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn(hook.dots, "size-3 shrink-0", className)}
    >
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={col * 4.5}
            y={row * 4.5}
            width="3"
            height="3"
            rx="0.6"
            fill="currentColor"
            className={live ? "animate-pulse" : undefined}
          />
        )),
      )}
    </svg>
  );
}

/** "Wondered for 18s ›" — the turn header: collapsible, with a divider under it (29, 37, 51). */
function TurnHeader({
  label,
  live,
  children,
}: {
  label: string;
  live?: boolean;
  children?: ReactNode;
}) {
  const { expandWork } = useChatBehavior();
  const body = (
    <>
      {live && <DotGrid live className="text-muted-foreground" />}
      <span>{label}</span>
    </>
  );
  const row =
    "flex list-none items-center gap-2 border-b border-border p-0 pb-2 text-base leading-5.25 text-muted-foreground";
  if (!children)
    return (
      <div className={cn(hook.thinking, "mb-0.5")}>
        <div className={row}>{body}</div>
      </div>
    );
  return (
    <details
      open={expandWork || undefined}
      className={cn(
        hook.thinking,
        "group/think m-0 mb-0.5 rounded-none border-0 bg-transparent p-0 text-base leading-5.25",
      )}
    >
      <summary className={cn(row, "hover:text-foreground-3")}>
        {body}
        <ChevronRightIcon className="size-3 transition-transform group-open/think:rotate-90" />
      </summary>
      <div className="flex flex-col gap-1 pt-2.5">{children}</div>
    </details>
  );
}

/** Reasoning text inside the turn header. */
function ThinkingText({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return (
    <p className="py-1 text-sm leading-5 whitespace-pre-wrap text-muted-foreground">
      {text.trim()}
    </p>
  );
}

/**
 * Open state of a Collapsible that follows `force` whenever it changes (expand-work setting, a live step), and the
 * user's own toggles otherwise.
 */
function useForcedOpen(force: boolean) {
  const [open, setOpen] = useState(force);
  const [last, setLast] = useState(force);
  if (last !== force) {
    setLast(force);
    setOpen(force);
  }
  return [open, setOpen] as const;
}

const DISCLOSURE =
  "flex items-center gap-2 rounded-sm p-0 outline-hidden focus-visible:ring-1 focus-visible:ring-ring";

/* ---------- Tool calls: Wonder shows "Ran 5 commands ›" and the live step ("Editing the canvas", 39). ---------- */

const CANVAS = /^mcp__verynize__/;
const SHELL = /^(shell|bash|exec_command|local_shell)$/i;
const input = (part: ChatPart) =>
  part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {};
const base = (value: unknown) =>
  textOf(value ?? "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) ?? "";
const humanize = (name: string) => {
  const text = name.replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : name;
};

/** Icon, row label and the progressive "doing" label of a tool call. */
function describeTool(part: ChatPart) {
  const name = part.name ?? "";
  const args = input(part);
  const title = part.title || name;
  if (CANVAS.test(name)) {
    const tool = name.replace(CANVAS, "");
    const live = /screenshot|capture/.test(tool)
      ? "Taking a screenshot"
      : /^(get|list|read|search|find|describe|inspect)/.test(tool)
        ? "Reading the canvas"
        : /export/.test(tool)
          ? "Exporting from the canvas"
          : "Editing the canvas";
    return { Icon: SquareTerminalIcon, label: humanize(tool), mono: false, live };
  }
  if (SHELL.test(name)) {
    const command = textOf(args.command ?? title.replace(/^\S+\s/, ""));
    return { Icon: SquareTerminalIcon, label: command, mono: true, live: `Running ${command}` };
  }
  const file = base(
    args.file_path ?? args.path ?? (Array.isArray(args.files) ? args.files[0] : ""),
  );
  if (/^(read|view_image|notebookread)$/i.test(name))
    return { Icon: FileTextIcon, label: `Read ${file}`, mono: false, live: `Reading ${file}` };
  if (/^(edit|write|multiedit|notebookedit|apply_patch)$/i.test(name))
    return {
      Icon: FilePenIcon,
      label: `Edited ${file || "files"}`,
      mono: false,
      live: `Editing ${file || "files"}`,
    };
  if (/^(grep|glob|ls)$/i.test(name))
    return {
      Icon: SearchIcon,
      label: title,
      mono: false,
      live: `Searching ${textOf(args.pattern ?? args.path ?? "")}`.trim(),
    };
  if (/web_?search|webfetch/i.test(name))
    return { Icon: GlobeIcon, label: title, mono: false, live: "Searching the web" };
  return { Icon: SquareTerminalIcon, label: title, mono: false, live: title };
}

const toolCount = (count: number) => `Ran ${count} ${count === 1 ? "command" : "commands"}`;

type Indexed = { part: ChatPart; index: number };
/** Subagent calls nested under their parent tool call (parentToolCallId → parent's id). */
type Nesting = { children: Map<string, Indexed[]>; nested: Set<number> };
function nestTools(parts: ChatPart[]): Nesting {
  const ids = new Set(parts.filter((p) => p.kind === "tool" && p.id).map((p) => p.id!));
  const children = new Map<string, Indexed[]>();
  const nested = new Set<number>();
  parts.forEach((part, index) => {
    const parent = part.parentToolCallId;
    if (!parent || parent === part.id || !ids.has(parent)) return;
    // Pending approvals and questions stay at the top level where they can be answered.
    if (part.kind !== "tool" && !(part.kind === "permission" && part.state !== "pending")) return;
    nested.add(index);
    children.set(parent, [...(children.get(parent) ?? []), { part, index }]);
  });
  return { children, nested };
}

/** Collapsible list of a tool call's subagent steps, indented under it. */
function SubSteps({
  items,
  nesting,
  onToggle,
}: {
  items: Indexed[];
  nesting: Nesting;
  onToggle: (index: number, open: boolean) => void;
}) {
  const live = items.some(
    ({ part }) => part.kind === "tool" && (part.state ?? "running") === "running",
  );
  const { expandWork } = useChatBehavior();
  const [open, setOpen] = useForcedOpen(live || expandWork);
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <div className="group/sub m-0 ml-1.5 border-l border-border pl-3.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(DISCLOSURE, "h-6 text-sm text-subtle-foreground hover:text-foreground-3")}
          >
            {items.length} {items.length === 1 ? "step" : "steps"}
            <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/sub:rotate-90 motion-reduce:transition-none" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col">
          {items.map(({ part, index }) =>
            part.kind === "tool" ? (
              <ToolRow
                key={index}
                part={part}
                nesting={nesting}
                onToggle={(open) => onToggle(index, open)}
                onToggleChild={onToggle}
              />
            ) : part.kind === "permission" ? (
              <PermissionRow key={index} part={part} />
            ) : null,
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ToolRow({
  part,
  onToggle,
  nesting,
  onToggleChild,
}: {
  part: ChatPart;
  onToggle: (open: boolean) => void;
  nesting?: Nesting;
  onToggleChild?: (index: number, open: boolean) => void;
}) {
  const kids = (part.id && nesting?.children.get(part.id)) || [];
  const { expandWork } = useChatBehavior();
  const state = part.state || "running";
  const { Icon, label, mono } = describeTool(part);
  const args = input(part);
  const shell = SHELL.test(part.name ?? "");
  const body =
    !part.hasInput && part.partialInput
      ? part.partialInput
      : shell && args.command
        ? textOf(args.command)
        : pretty(part.input ?? {});
  const block =
    "m-0 max-h-55 overflow-auto font-mono text-xs leading-4.5 break-words whitespace-pre-wrap";
  const row = (
    <details
      className={cn(
        hook.tool,
        "group/tool m-0 rounded-none border-0 bg-transparent p-0",
        stateHook(state),
      )}
      open={part.open ?? expandWork}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary
        title={part.title || part.name}
        className="flex h-6 list-none items-center gap-2 p-0 text-sm text-muted-foreground hover:text-foreground-3"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className={cn(hook.toolTitle, "min-w-0 truncate", mono && "font-mono text-xs")}>
          {label}
        </span>
        {state === "running" && (
          <span className={cn(hook.toolState, "flex shrink-0")}>
            <Spinner role="img" aria-label="running" className="size-3.5" />
          </span>
        )}
        {(state === "error" || state === "interrupted") && (
          <CircleAlertIcon
            aria-label={state}
            className={cn(
              hook.toolState,
              "size-3.5 shrink-0",
              state === "error" ? "text-destructive" : "text-subtle-foreground",
            )}
          />
        )}
        <ChevronRightIcon className="size-3 shrink-0 opacity-0 transition-transform group-open/tool:rotate-90 group-open/tool:opacity-100 group-hover/tool:opacity-100" />
      </summary>
      <div
        className={cn(
          hook.toolBody,
          "mt-1 mb-1.5 ml-5.5 overflow-hidden rounded-lg border border-card-border bg-card",
        )}
      >
        <pre className={cn(block, "px-2.5 py-2 text-foreground-3")}>{body}</pre>
        {part.result !== undefined && (
          <pre
            className={cn(
              block,
              "border-t border-card-border px-2.5 py-2",
              state === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {part.result || "(no output)"}
          </pre>
        )}
      </div>
    </details>
  );
  if (!kids.length || !nesting || !onToggleChild) return row;
  return (
    <div className="flex flex-col">
      {row}
      <SubSteps items={kids} nesting={nesting} onToggle={onToggleChild} />
    </div>
  );
}

/** Completed tool calls of a running turn, collapsed to "Ran N commands ›" (39). */
function ToolGroup({
  tools,
  nesting,
  onToggle,
}: {
  tools: Indexed[];
  nesting: Nesting;
  onToggle: (index: number, open: boolean) => void;
}) {
  const { expandWork } = useChatBehavior();
  const [open, setOpen] = useForcedOpen(expandWork);
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <div className="group/tools m-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              DISCLOSURE,
              "text-base leading-5.25 text-muted-foreground hover:text-foreground-3",
            )}
          >
            {toolCount(tools.length)}
            <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/tools:rotate-90" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent asChild>
          <div className="flex flex-col pt-1.5">
            {tools.map(({ part, index }) => (
              <ToolRow
                key={index}
                part={part}
                nesting={nesting}
                onToggle={(next) => onToggle(index, next)}
                onToggleChild={onToggle}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** The step a running turn is on: "Editing the canvas" with a shimmer-free pulse (39). */
function LiveStep({ part, nesting }: { part: ChatPart; nesting: Nesting }) {
  const child =
    (part.id &&
      nesting.children
        .get(part.id)
        ?.findLast(({ part: p }) => p.kind === "tool" && (p.state ?? "running") === "running")
        ?.part) ||
    null;
  const { Icon, live } = describeTool(child ?? part);
  return (
    <p
      className={cn("flex min-w-0 items-center gap-2 text-base leading-5.25 text-muted-foreground")}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 animate-pulse truncate">{live}</span>
    </p>
  );
}

function PermissionCard({
  part,
  onAnswer,
}: {
  part: ChatPart;
  onAnswer: (allow: boolean, always?: boolean) => void;
}) {
  const args = input(part);
  const detail =
    typeof args.command === "string" ? args.command : pretty(part.input).slice(0, 2000);
  return (
    <div className={cn(hook.permission, stateHook(part.state))}>
      <Card>
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ShieldQuestionIcon className="size-3.5 text-primary-text" />
              Approval needed
            </span>
          </CardDescription>
          <CardTitle>
            <span className="block text-base leading-5.25 font-normal break-words">
              Allow {part.title || part.toolName}?
            </span>
          </CardTitle>
        </CardHeader>
        {detail && detail !== "{}" && (
          <CardContent>
            <pre className="m-0 max-h-40 overflow-auto rounded-lg border border-card-border bg-settings px-2.5 py-2 font-mono text-xs leading-4.5 break-words whitespace-pre-wrap text-foreground-3">
              {detail}
            </pre>
          </CardContent>
        )}
        <CardFooter>
          <div className="flex w-full justify-end gap-1.5">
            <ChatActionButton variant="outline" hook={hook.deny} onClick={() => onAnswer(false)}>
              Deny
            </ChatActionButton>
            {/* The model API (web) decides each call on its own: it has no "always allow" (docs/ai-runtime.md). */}
            {platform.kind !== "web" && (
              <ChatTip label={`Allow ${part.toolName || "this tool"} for the rest of this chat`}>
                <ChatActionButton variant="outline" onClick={() => onAnswer(true, true)}>
                  Always allow
                </ChatActionButton>
              </ChatTip>
            )}
            <ChatActionButton hook={hook.allow} onClick={() => onAnswer(true)}>
              Allow
            </ChatActionButton>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

/** A permission that was answered (or expired): one quiet row in the turn's details. */
function PermissionRow({ part }: { part: ChatPart }) {
  const allowed = part.state === "allowed";
  const Icon = allowed ? ShieldCheckIcon : ShieldXIcon;
  const verb =
    { allowed: "Allowed", denied: "Denied", expired: "Expired" }[part.state ?? ""] ?? part.state;
  return (
    <p
      className={cn(
        hook.permission,
        stateHook(part.state),
        "flex h-6 min-w-0 items-center gap-2 text-sm text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {verb}: {part.title || part.toolName}
      </span>
    </p>
  );
}

/** Autonomy summary of a run and the runtime's automatic decisions (desktop/agent-autonomy.cjs). */
function NoticeRow({ part }: { part: ChatPart }) {
  const decision = (part as ChatPart & { decision?: string }).decision;
  const Icon =
    part.kind === "autonomy" || decision === "limit"
      ? GaugeIcon
      : decision === "allow"
        ? ShieldCheckIcon
        : ShieldOffIcon;
  return (
    <div
      data-chat-notice={part.kind}
      data-decision={decision ?? ""}
      className={cn(
        "flex items-start gap-1.5 text-xs leading-4",
        decision === "limit" || decision === "deny" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0 break-words">
        {part.kind === "autonomy" ? `Autonomy: ${part.text}` : part.text}
      </span>
    </div>
  );
}

function ErrorRow({ text }: { text?: string }) {
  return (
    // Not a live region (role unset): transcripts re-render whole, and old errors must not be re-announced.
    <div className={hook.error}>
      <Alert variant="destructive" role={undefined}>
        <CircleAlertIcon />
        <AlertDescription>
          <p className="min-w-0 break-words whitespace-pre-wrap">{text}</p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

const STATE_NOTE: Record<string, string> = {
  stopped: "Agent stopped",
  failed: "Agent failed",
  interrupted: "Agent interrupted",
  error: "Agent error",
};

/* ---------- Per-message actions (hover / focus-within; absolutely placed, so no layout shift) ---------- */

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <ChatTip label={label} side="bottom">
      <ChatIconButton size="xs" aria-label={label} onClick={onClick}>
        {children}
      </ChatIconButton>
    </ChatTip>
  );
}

/** Text of a message for the clipboard: the visible reply, not tool output. */
function messageText(message: ChatMessage) {
  const parts = (message.parts ?? [])
    .filter((p) => p.kind === "text" && p.text?.trim())
    .map((p) => p.text!.trim());
  return parts.length ? parts.join("\n\n") : message.text;
}

function CopyButton({ index, message }: { index: number; message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <ActionButton
      label={copied ? "Copied" : "Copy"}
      onClick={() => {
        const ws = workspace();
        if (ws?.copyMessage) ws.copyMessage(index);
        else void navigator.clipboard?.writeText(messageText(message));
        setCopied(true);
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </ActionButton>
  );
}

/**
 * "Rewind to here" with an inline confirmation: removes this and later messages, continues the agent
 * session from the reply before it and, when a canvas checkpoint exists, restores the canvas too.
 */
function RestoreButton({ index, canvas }: { index: number; canvas: boolean }) {
  const label = canvas ? "Restore checkpoint" : "Rewind to here";
  return (
    <ChatMenu modal={false}>
      <ChatMenuTrigger asChild>
        <ChatIconButton size="xs" title={label} aria-label={label}>
          <HistoryIcon className="size-3.5" />
        </ChatIconButton>
      </ChatMenuTrigger>
      <ChatMenuContent align="end" side="bottom" className="w-64">
        <ChatMenuNote>
          {canvas
            ? "Restore the canvas to how it was before this message? Later messages are removed and the agent continues from here."
            : "Rewind the chat to before this message? Later messages are removed and the agent continues from here. Files and the canvas are not changed."}
        </ChatMenuNote>
        <ChatMenuSeparator />
        <ChatMenuItem onSelect={() => workspace()?.rewindTo?.(index)}>
          <HistoryIcon />
          {canvas ? "Restore to here" : "Rewind to here"}
        </ChatMenuItem>
        <ChatMenuItem>Cancel</ChatMenuItem>
      </ChatMenuContent>
    </ChatMenu>
  );
}

function ActionBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        hook.messageActions,
        "absolute top-full z-10 mt-0.5 flex items-center gap-0.5 opacity-0 group-focus-within/msg:opacity-100 group-hover/msg:opacity-100 has-[[data-state=open]]:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ForkButton({ index }: { index: number }) {
  return (
    <ActionButton
      label="Continue from here (forks the transcript; files are not reverted)"
      onClick={() => workspace()?.forkAt(index)}
    >
      <GitBranchIcon className="size-3.5" />
    </ActionButton>
  );
}

// Context chip inside a user bubble (37): bordered, on the bubble's fill.
const USER_CHIP =
  "flex h-6 max-w-full items-center gap-1.5 rounded-md border border-chat-chip-border px-2 text-foreground-2";

function EditBox({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = () => {
    const text = value.trim();
    if (text && text !== initial.trim()) onSave(text);
    else onCancel();
  };
  return (
    <div className="flex w-full flex-col gap-2">
      {/* Edits in place inside the bubble (the bubble is the field), so a bare native textarea, not a bordered input. */}
      <textarea
        ref={ref}
        value={value}
        aria-label="Edit message"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
        className="max-h-60 min-h-10 w-full resize-none bg-transparent text-base leading-5.25 text-foreground outline-hidden field-sizing-content"
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-xs text-subtle-foreground">Resends from here</span>
        <ChatActionButton variant="outline" onClick={onCancel}>
          Cancel
        </ChatActionButton>
        <ChatActionButton onClick={save}>Send</ChatActionButton>
      </div>
    </div>
  );
}

function UserMessage({
  message,
  index,
  busy,
}: {
  message: ChatMessage;
  index: number;
  busy: boolean;
}) {
  const ws = workspace();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLSpanElement>(null);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.querySelector("button")?.focus());
  };
  const mentions = message.mentions ?? [];
  // The Preview's setup request is an app action, not typed text: logo + purple label, no context chips (PS2).
  const setupRequest = message.text === PREVIEW_SETUP_REQUEST && !editing;
  return (
    <article
      className={cn(
        hook.userMessage,
        "group/msg relative m-0 flex w-full max-w-none flex-col items-end rounded-none border-0 bg-transparent p-0 text-base leading-5.25 text-foreground",
      )}
    >
      <div
        className={cn("relative max-w-full rounded-2xl bg-input px-3 py-2", editing && "w-full")}
      >
        {setupRequest ? (
          <div
            data-preview-request
            className={cn(hook.messageContent, "flex items-center gap-1.5 text-preview-request")}
          >
            <LogoIcon className="size-3.5 shrink-0" />
            {message.text}
          </div>
        ) : null}
        {!setupRequest && (!!message.images?.length || !!message.canvas || mentions.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.canvas && (
              <span className={cn(USER_CHIP)}>
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{message.canvas}</span>
              </span>
            )}
            {mentions.map((mention) => (
              <span
                key={mention.id}
                className={cn(hook.mention, USER_CHIP)}
                title={mention.type ? `${mention.label} (${mention.type})` : mention.label}
              >
                {mention.type ? (
                  <MentionIcon type={mention.type} />
                ) : (
                  <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{mention.label}</span>
              </span>
            ))}
            {message.images?.map((name, i) => (
              <span key={i} className={cn(hook.images, USER_CHIP)}>
                <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        )}
        {setupRequest ? null : editing ? (
          <EditBox
            initial={message.text}
            onCancel={close}
            onSave={(text) => {
              setEditing(false);
              ws?.editMessage?.(index, text);
            }}
          />
        ) : (
          <div className={cn(hook.messageContent, "break-words whitespace-pre-wrap")}>
            {message.text}
          </div>
        )}
        {!busy && !editing && (
          // Fork stays the first button of a user message (tests/agent-chat.cjs clicks `.chat-message.user button`).
          <ActionBar className="right-0">
            <ForkButton index={index} />
            <CopyButton index={index} message={message} />
            {ws?.editMessage && (
              <span ref={editButton} className="contents">
                <ActionButton label="Edit message" onClick={() => setEditing(true)}>
                  <PencilIcon className="size-3.5" />
                </ActionButton>
              </span>
            )}
            {ws?.rewindTo && <RestoreButton index={index} canvas={!!message.checkpoint} />}
          </ActionBar>
        )}
      </div>
    </article>
  );
}

type Block =
  | { type: "text"; key: string; text: string }
  | { type: "tools"; key: string; done: Indexed[]; live?: Indexed }
  | { type: "permission"; key: string; item: Indexed }
  | { type: "question"; key: string; item: Indexed }
  | { type: "error"; key: string; text?: string }
  | { type: "auth"; key: string; item: Indexed }
  | { type: "notice"; key: string; part: ChatPart }
  | { type: "preview"; key: string; part: ChatPart };

/** Visible blocks of a running turn: text, "Ran N commands" + live step, pending approvals, errors. */
function runningBlocks(parts: ChatPart[], nesting: Nesting): Block[] {
  const blocks: Block[] = [];
  parts.forEach((part, index) => {
    if (nesting.nested.has(index)) return;
    const key = `${index}-${part.kind}`;
    if (part.kind === "text" && part.text?.trim())
      blocks.push({ type: "text", key, text: part.text });
    else if (part.kind === "tool") {
      let last = blocks.at(-1);
      if (last?.type !== "tools") {
        last = { type: "tools", key, done: [] };
        blocks.push(last);
      }
      if (part.state === "running") last.live = { part, index };
      else last.done.push({ part, index });
      if (savedPreview(part)) blocks.push({ type: "preview", key: `${key}-preview`, part });
    } else if (part.kind === "permission")
      blocks.push({ type: "permission", key, item: { part, index } });
    else if (part.kind === "question")
      blocks.push({ type: "question", key, item: { part, index } });
    else if (part.kind === "error") blocks.push({ type: "error", key, text: part.text });
    else if (part.kind === "auth") blocks.push({ type: "auth", key, item: { part, index } });
    else if ((part.kind === "autonomy" && part.text) || part.kind === "policy")
      blocks.push({ type: "notice", key, part });
  });
  return blocks;
}

/** verynize:// links reported by finish_artboard tool results (designLink), deduplicated. */
function artboardLinks(parts: ChatPart[]): { url: string; name?: string }[] {
  const out = new Map<string, string | undefined>();
  for (const part of parts) {
    if (part.kind !== "tool" || !/finish_artboard/i.test(part.name ?? "") || !part.result) continue;
    let name: string | undefined;
    try {
      const parsed = JSON.parse(part.result) as Record<string, unknown>;
      if (typeof parsed.name === "string") name = parsed.name;
      if (typeof parsed.designLink === "string" && /^verynize:\/\//i.test(parsed.designLink))
        out.set(parsed.designLink, name);
    } catch {
      // Plain-text result: fall through to the URL scan.
    }
    for (const match of part.result.matchAll(/verynize:\/\/[^\s"'<>()`\]]+/gi))
      if (!out.has(match[0])) out.set(match[0], name);
  }
  return [...out].map(([url, name]) => ({ url, name }));
}

function ArtboardPill({ url, name }: { url: string; name?: string }) {
  return (
    <ChatPillButton
      hook={hook.artboardLink}
      title={url}
      onClick={() => openAppLink(url)}
      className="max-w-full self-start"
    >
      <FrameIcon className="size-3.5 shrink-0 text-primary-text" />
      <span className="truncate">{name ? `Open ${name}` : "Open artboard"}</span>
    </ChatPillButton>
  );
}

function AssistantMessage({
  message,
  index,
  busy,
  live,
}: {
  message: ChatMessage;
  index: number;
  busy: boolean;
  live: boolean;
}) {
  const ws = workspace();
  // A second opinion runs outside the chat's task slot, so it is "live" on its own.
  const running = (live || !!message.review) && message.state === "running";
  const now = useNow(running);
  const parts = message.parts ?? [];
  const nesting = nestTools(parts);
  const toggle = (partIndex: number, open: boolean) => ws?.setPartOpen(index, partIndex, open);
  const answer = (partIndex: number, allow: boolean, always?: boolean) =>
    always
      ? ws?.answerPermission(index, partIndex, allow, true)
      : ws?.answerPermission(index, partIndex, allow);
  const answerQuestion = ws?.answerQuestion
    ? (partIndex: number) => (answers: Record<string, string>) =>
        ws.answerQuestion?.(index, partIndex, answers)
    : null;
  const question = (part: ChatPart, partIndex: number, key: string | number) => (
    <QuestionCard key={key} part={part} onSubmit={answerQuestion?.(partIndex)} />
  );
  const thinking = parts.filter((p) => p.kind === "thinking" && p.text?.trim());
  const links = ws?.openLink ? artboardLinks(parts) : [];
  let content: ReactNode;
  if (running) {
    const blocks = runningBlocks(parts, nesting);
    content = (
      <>
        <TurnHeader live label={`Wondering for ${seconds(message.at, now)}s`}>
          {thinking.length
            ? thinking.map((part, i) => <ThinkingText key={i} text={part.text} />)
            : undefined}
        </TurnHeader>
        {blocks.length === 0 && <p className="text-muted-foreground">Thinking</p>}
        {blocks.map((block) => {
          if (block.type === "text") return <Markdown key={block.key} text={block.text} />;
          if (block.type === "error") return <ErrorRow key={block.key} text={block.text} />;
          if (block.type === "auth")
            return <AuthCard key={block.key} part={block.item.part} index={index} busy={busy} />;
          if (block.type === "notice") return <NoticeRow key={block.key} part={block.part} />;
          if (block.type === "preview")
            return <PreviewSavedCard key={block.key} part={block.part} />;
          if (block.type === "question")
            return question(block.item.part, block.item.index, block.key);
          if (block.type === "permission")
            return block.item.part.state === "pending" ? (
              <PermissionCard
                key={block.key}
                part={block.item.part}
                onAnswer={(allow, always) => answer(block.item.index, allow, always)}
              />
            ) : (
              <PermissionRow key={block.key} part={block.item.part} />
            );
          return (
            <div key={block.key} className="flex flex-col gap-3">
              {block.done.length > 0 && (
                <ToolGroup tools={block.done} nesting={nesting} onToggle={toggle} />
              )}
              {block.live && <LiveStep part={block.live.part} nesting={nesting} />}
            </div>
          );
        })}
      </>
    );
  } else {
    // Finished turn: "Wondered for Ns ›" holds the work (reasoning, tool calls, approvals); the answer stays visible.
    const work = parts.flatMap((part, partIndex) => {
      if (nesting.nested.has(partIndex)) return [];
      if (part.kind === "thinking") return [<ThinkingText key={partIndex} text={part.text} />];
      if (part.kind === "tool")
        return [
          <ToolRow
            key={partIndex}
            part={part}
            nesting={nesting}
            onToggle={(open) => toggle(partIndex, open)}
            onToggleChild={toggle}
          />,
        ];
      if (part.kind === "permission") return [<PermissionRow key={partIndex} part={part} />];
      if (part.kind === "policy" && (part as ChatPart & { decision?: string }).decision !== "limit")
        return [<NoticeRow key={partIndex} part={part} />];
      return [];
    });
    const tools = parts.filter((p) => p.kind === "tool").length;
    const timed = message.at && message.end;
    const label = timed
      ? `Wondered for ${seconds(message.at, message.end)}s`
      : tools
        ? toolCount(tools)
        : "Thought";
    const answerParts = parts
      .map((part, partIndex) => ({ part, index: partIndex }))
      .filter(
        ({ part: p }) =>
          (p.kind === "text" && p.text?.trim()) ||
          p.kind === "error" ||
          p.kind === "auth" ||
          p.kind === "question" ||
          !!savedPreview(p) ||
          (p.kind === "autonomy" && !!p.text) ||
          (p.kind === "policy" && (p as ChatPart & { decision?: string }).decision === "limit"),
      );
    content = (
      <>
        {(work.length > 0 || (timed && parts.some((p) => p.kind !== "auth"))) && (
          <TurnHeader label={label}>{work.length ? work : undefined}</TurnHeader>
        )}
        {parts.length === 0 &&
          message.text &&
          (message.state === "error" ? (
            <ErrorRow text={message.text} />
          ) : (
            <Markdown text={message.text} />
          ))}
        {answerParts.map(({ part, index: partIndex }) =>
          part.kind === "error" ? (
            <ErrorRow key={partIndex} text={part.text} />
          ) : part.kind === "auth" ? (
            <AuthCard key={partIndex} part={part} index={index} busy={busy} />
          ) : part.kind === "autonomy" || part.kind === "policy" ? (
            <NoticeRow key={partIndex} part={part} />
          ) : part.kind === "question" ? (
            question(part, partIndex, partIndex)
          ) : part.kind === "tool" ? (
            <PreviewSavedCard key={partIndex} part={part} />
          ) : (
            <Markdown key={partIndex} text={part.text ?? ""} />
          ),
        )}
      </>
    );
  }

  const usage = !running && message.usage ? usageSummary(message.usage) : "";
  return (
    <article
      className={cn(
        hook.assistantMessage,
        "group/msg relative m-0 flex w-full max-w-none flex-col gap-2.5 rounded-none border-0 bg-transparent p-0 text-base leading-5.25 text-foreground",
      )}
    >
      {message.review && (
        <p className="flex items-center gap-1.5 text-xs text-subtle-foreground">
          <ScaleIcon className="size-3.5" />
          Second opinion · {message.agent === "codex" ? "Codex" : "Claude"}
          {message.review.diff ? " · answer and uncommitted changes" : ""}
        </p>
      )}
      {content}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <ArtboardPill key={link.url} url={link.url} name={link.name} />
          ))}
        </div>
      )}
      {message.state && STATE_NOTE[message.state] && !parts.some((p) => p.kind === "auth") && (
        <p className="text-sm text-subtle-foreground">{STATE_NOTE[message.state]}</p>
      )}
      {usage && (
        <p className={cn(hook.usage, "self-end text-xs text-subtle-foreground tabular-nums")}>
          {usage}
        </p>
      )}
      {!busy && (
        <ActionBar className="left-0">
          <ForkButton index={index} />
          <CopyButton index={index} message={message} />
          {ws?.retry && !message.review && (
            <ActionButton label="Retry" onClick={() => ws.retry?.(index)}>
              <RotateCcwIcon className="size-3.5" />
            </ActionButton>
          )}
          {ws?.secondOpinion && !message.review && message.state !== "error" && (
            <ActionButton
              label={`Second opinion from ${message.agent === "codex" ? "Claude" : "Codex"} (read-only review)`}
              onClick={() => ws.secondOpinion?.(index)}
            >
              <ScaleIcon className="size-3.5" />
            </ActionButton>
          )}
        </ActionBar>
      )}
    </article>
  );
}

type Suggestion = NonNullable<ChatState["suggestions"]>[number];
const SHOWN_SUGGESTIONS = 4;
/** A window of consecutive starter briefs, rotated per conversation (stable for a chat, varied across chats). */
function pickSuggestions(suggestions: Suggestion[], seed: string | null): Suggestion[] {
  if (suggestions.length <= SHOWN_SUGGESTIONS) return suggestions;
  let hash = 0;
  for (const char of seed ?? "") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const start = hash % suggestions.length;
  return Array.from(
    { length: SHOWN_SUGGESTIONS },
    (_, i) => suggestions[(start + i) % suggestions.length],
  );
}

/** Empty chat (34, 35): logo + prompt, with a few of the workspace's starter briefs as cards that fill the composer. */
function EmptyState({ suggestions, seed }: { suggestions: Suggestion[]; seed: string | null }) {
  // A brief written for a catalog style also pins that style (window.chatDesignStyle), so the run carries `designStyle`.
  const fill = ({ prompt, style }: Suggestion) => {
    const el = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
    if (!el) return;
    if (style) window.chatDesignStyle?.set(style);
    legacySet(el, prompt);
    el.focus();
    el.setSelectionRange(prompt.length, prompt.length);
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-42 text-center">
      <LogoIcon className="size-7 text-muted-foreground" />
      <p className="text-base leading-5.25 font-medium text-foreground">
        What would you like to work on?
      </p>
      {suggestions.length > 0 && (
        <ul
          aria-label="Suggestions"
          className="m-0 mt-3 grid w-full max-w-100 list-none grid-cols-2 gap-1.5 p-0"
        >
          {pickSuggestions(suggestions, seed).map((item) => (
            <li key={item.title} data-suggestion={item.title} className="flex">
              <ChatSuggestionButton
                hook={hook.suggestion}
                title={item.prompt}
                onClick={() => fill(item)}
                className="w-full"
              >
                <span className="w-full truncate text-sm text-foreground-2">{item.title}</span>
                <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                  {item.prompt}
                </span>
              </ChatSuggestionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Transcript({ state }: { state: ChatState }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const lastLength = useRef(0);
  const lastConversation = useRef<string | null>(null);
  const sessionSlot = useAdopt("chat-session", (el) => {
    // Session line (test contract) stays readable by assistive tech but is not shown, as in Wonder.
    el.className = cn(hook.session, "sr-only");
  });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (lastConversation.current !== state.conversationId) {
      lastConversation.current = state.conversationId;
      pinned.current = true;
    }
    // A new turn (the user's own message) always follows the bottom again.
    if (state.messages.length > lastLength.current) pinned.current = true;
    lastLength.current = state.messages.length;
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [state]);

  // Stay pinned to the bottom when the content or the viewport resizes (fonts, composer chips, streaming).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.lastElementChild ?? el.firstElementChild);
    return () => observer.disconnect();
  }, [state.messages.length]);

  const lastAssistant = state.messages.findLastIndex((m) => m.role === "assistant");
  return (
    <div
      ref={scroller}
      onClick={(event) => {
        // Expanding a row is reading, not following: keep the row where it is instead of jumping to the bottom.
        if ((event.target as HTMLElement).closest("summary, [data-slot=collapsible-trigger]"))
          pinned.current = false;
      }}
      onScroll={(event) => {
        const el = event.currentTarget;
        // Re-pin near the bottom; unpin only when the user scrolls up (resizes and zoom changes must not unpin).
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) pinned.current = true;
        else if (el.scrollTop < lastTop.current - 1) pinned.current = false;
        lastTop.current = el.scrollTop;
      }}
      className={cn(
        hook.scroll,
        "flex min-h-0 flex-1 flex-col overflow-y-auto pt-4 pr-4 pb-6 pl-6",
      )}
    >
      <div ref={sessionSlot} className="contents" />
      {/* `--chat-column` is set by hosts with a centered column (Code workspace, 770px); unset in the dock. */}
      {state.messages.length === 0 ? (
        <EmptyState suggestions={state.suggestions ?? []} seed={state.conversationId} />
      ) : (
        <div className="mx-auto flex w-full max-w-(--chat-column) flex-col gap-5">
          {state.messages.map((message, index) =>
            message.role === "user" ? (
              <UserMessage key={index} message={message} index={index} busy={state.busy} />
            ) : (
              <AssistantMessage
                key={index}
                message={message}
                index={index}
                busy={state.busy}
                live={state.busy && index === lastAssistant}
              />
            ),
          )}
        </div>
      )}
      {state.queued > 0 && !state.queue?.length && (
        <p className="mt-4 text-xs text-primary-text">
          {state.queued} {state.queued === 1 ? "task" : "tasks"} queued
        </p>
      )}
    </div>
  );
}
