// Composer (29–32, 35–37, 51): context chips, the adopted #project-prompt textarea, "⌘L to focus", and the bottom
// row — attach menu (+), model picker (.agent-config summary), access menu, Stop and Send. Picked agent commands and
// skills stay in the prompt text as "/name"; a mirror behind the textarea draws them as badges.
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import {
  CircleDotIcon,
  FileTextIcon,
  ImageIcon,
  HandIcon,
  LockOpenIcon,
  NavigationIcon,
  PencilIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { ClaudeMark, CodexMark, PlusIcon } from "@/components/icons";
import { legacySet } from "@/lib/bridge";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAdopt } from "./adopt";
import { useChatBehavior } from "./behavior";
import { ChatChipButton, ChatIconButton } from "./controls";
import { hook } from "./hooks";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuGroup,
  ChatMenuItem,
  ChatMenuLabel,
  ChatMenuOptionItem,
  ChatMenuRadioGroup,
  ChatMenuRadioItem,
  ChatMenuSeparator,
  ChatMenuSub,
  ChatMenuSubContent,
  ChatMenuSubTrigger,
  ChatMenuTrigger,
} from "./menu";
import { MentionIcon, MentionPopover } from "./mention-popover";
import { agentAvailable, useModels, workspace, type AgentModel, type ChatState } from "./store";
import { ToolsPopover } from "./tools-popover";
import { UsageRing } from "./usage-ring";
import { AutonomyPopover } from "./autonomy-panel";
import { AttachMenu, WorkingDirectories } from "./attach-menu";
import { SlashCommands } from "./slash-commands";
import { StylePicker } from "./style-picker";
import { WorksWith } from "./works-with";
import { commandEndingAt, commandFirst, moveCommandFirst, promptRuns } from "./composer-actions";

// `relative` keeps the textarea (caret, selection) above the absolutely positioned mirror.
const PROMPT_CLASS =
  "relative m-0 block max-h-55 min-h-17 w-full resize-none rounded-none border-0 bg-transparent pt-2 pr-2.5 pb-1 pl-2.5 font-sans text-base leading-5.25 text-foreground shadow-none outline-hidden field-sizing-content placeholder:text-transparent focus:outline-hidden focus-visible:outline-hidden";

/** Web build: the chat runs on the cloud backend's model API (agent `openrouter`); Claude/Codex are desktop-only. */
const WEB = platform.kind === "web";
const MODEL_API = "openrouter";

const Mark = ({ agent }: { agent: string }) =>
  agent === "claude" ? (
    <ClaudeMark />
  ) : agent === MODEL_API ? (
    <SparklesIcon className="size-3.5 text-muted-foreground" />
  ) : (
    <CodexMark />
  );
const agentLabel = (agent: string) =>
  agent === "claude" ? "Claude" : agent === MODEL_API ? "OpenRouter" : "Codex";

const ACCESS = [
  {
    value: "ask",
    label: "Ask",
    title: "Ask",
    hint: "Asks before edits and commands.",
    Icon: HandIcon,
  },
  {
    value: "edit",
    label: "Edit",
    title: "Edit automatically",
    hint: "Edits freely; asks before commands.",
    Icon: PencilIcon,
  },
  {
    value: "auto",
    label: "Auto",
    title: "Auto",
    hint: "Asks only about risky actions.",
    Icon: NavigationIcon,
  },
  {
    value: "full",
    label: "Full access",
    title: "Full access",
    hint: "Edits and runs without asking.",
    Icon: LockOpenIcon,
  },
] as const;
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const effortLabel = (value: string) =>
  value ? value[0].toUpperCase() + value.slice(1) : "Default";
const AGENTS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];

/* ---------- Model picker (30). Trigger is `.agent-config summary` (test contract). ---------- */
function ModelMenu({
  state,
  open,
  onOpenChange,
}: {
  state: ChatState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { agent, model, effort } = state.defaults;
  const claude = useModels("claude", !WEB && open && agentAvailable("claude"));
  const codex = useModels("codex", !WEB && open && agentAvailable("codex"));
  const modelApi = useModels(MODEL_API, WEB && open && agentAvailable(MODEL_API));
  const lists: Record<string, AgentModel[]> = { claude, codex, [MODEL_API]: modelApi };
  const providers = WEB ? [{ id: MODEL_API, label: "OpenRouter" }] : AGENTS;
  const name = model
    ? (lists[agent]?.find((m) => m.id === model)?.name ?? model)
    : agentLabel(agent);
  const choose = (next: Partial<ChatState["defaults"]>) => {
    const ws = workspace();
    if (ws) ws.setDefaults({ ...ws.getDefaults(), ...next });
  };
  const modelSlot = useAdopt("agent-model", (el) => {
    el.className =
      "m-0 h-6 min-w-0 flex-1 rounded-md border border-card-border bg-input px-2 text-sm text-foreground-2 shadow-none outline-hidden placeholder:text-subtle-foreground focus:border-ring";
    (el as HTMLInputElement).placeholder = "Custom model id";
  });
  return (
    <ChatMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <div className={cn(hook.agentConfig, "contents")}>
        <ChatMenuTrigger asChild>
          <ChatChipButton asChild>
            <summary tabIndex={0} role="button" aria-label="Model and effort" className="list-none">
              <Mark agent={agent} />
              <span id="bd-agent-model-label" className="max-w-40 truncate">
                {name}
              </span>
              {effort && <span className="text-subtle-foreground">{effortLabel(effort)}</span>}
            </summary>
          </ChatChipButton>
        </ChatMenuTrigger>
      </div>
      <ChatMenuContent align="start" side="top" className="w-60">
        {providers.map((provider, i) => {
          const available = agentAvailable(provider.id);
          const list = lists[provider.id];
          return (
            <ChatMenuGroup key={provider.id}>
              {i > 0 && <ChatMenuSeparator />}
              <ChatMenuLabel className="justify-between">
                {WEB ? "Model API" : i === 0 ? "Agent model" : provider.label}
                {!available && (
                  <span className="text-subtle-foreground">
                    {WEB ? "Not available" : "Not installed"}
                  </span>
                )}
              </ChatMenuLabel>
              <ChatMenuItem
                disabled={!available}
                checked={agent === provider.id && !model}
                onSelect={() => choose({ agent: provider.id, model: "" })}
              >
                <Mark agent={provider.id} />
                {provider.label} default
              </ChatMenuItem>
              {list.map((m) => (
                <ChatMenuItem
                  key={m.id}
                  disabled={!available}
                  title={m.description}
                  checked={agent === provider.id && model === m.id}
                  onSelect={() => choose({ agent: provider.id, model: m.id })}
                >
                  <Mark agent={provider.id} />
                  <span className="truncate">{m.name}</span>
                </ChatMenuItem>
              ))}
            </ChatMenuGroup>
          );
        })}
        {/* The model API takes the server's model list only (VERYNIZE_AI_MODELS): no free-text id, no effort. */}
        <div className={cn("contents", WEB && "hidden")}>
          <ChatMenuSeparator />
          {/* Free-text model id: the legacy #agent-model input (datalist + change handler) adopted here. */}
          <div
            className="flex h-7 items-center gap-2 px-2"
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
          >
            <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <div ref={modelSlot} className="flex min-w-0 flex-1" />
          </div>
          <ChatMenuSeparator />
          <ChatMenuSub>
            <ChatMenuSubTrigger>
              Effort
              <span className="ml-auto text-muted-foreground">{effortLabel(effort)}</span>
            </ChatMenuSubTrigger>
            <ChatMenuSubContent className="w-36">
              <ChatMenuRadioGroup
                value={effort}
                onValueChange={(value) => choose({ effort: value })}
              >
                {EFFORTS.map((value) => (
                  <ChatMenuRadioItem key={value || "default"} value={value}>
                    {effortLabel(value)}
                  </ChatMenuRadioItem>
                ))}
              </ChatMenuRadioGroup>
            </ChatMenuSubContent>
          </ChatMenuSub>
        </div>
      </ChatMenuContent>
    </ChatMenu>
  );
}

/* ---------- Access (31) ---------- */
function AccessMenu({ access }: { access: string }) {
  const current = ACCESS.find((a) => a.value === access) ?? ACCESS[1];
  return (
    <ChatMenu modal={false}>
      <ChatMenuTrigger asChild>
        <ChatChipButton id="agent-access-trigger" aria-label={`Access: ${current.title}`}>
          <current.Icon className="size-3.5 text-muted-foreground" />
          {current.label}
        </ChatChipButton>
      </ChatMenuTrigger>
      <ChatMenuContent align="start" side="top" className="w-72">
        <ChatMenuLabel>Mode</ChatMenuLabel>
        <ChatMenuRadioGroup
          value={current.value}
          onValueChange={(value) => {
            const ws = workspace();
            if (ws) ws.setDefaults({ ...ws.getDefaults(), access: value });
          }}
        >
          {ACCESS.map(({ value, title, hint, Icon }) => (
            <ChatMenuOptionItem key={value} value={value}>
              <Icon className="mt-0.5 size-3.5 shrink-0 text-foreground-3" />
              <span className="flex min-w-0 flex-col">
                <span className="text-foreground">{title}</span>
                <span className="text-xs leading-4 text-muted-foreground">{hint}</span>
              </span>
            </ChatMenuOptionItem>
          ))}
        </ChatMenuRadioGroup>
      </ChatMenuContent>
    </ChatMenu>
  );
}

/* ---------- Attach (32): "+" menu in ./attach-menu.tsx, slash commands in ./slash-commands.tsx ---------- */

function Chip({
  icon,
  children,
  onRemove,
  label,
  removable = true,
}: {
  icon: ReactNode;
  children: ReactNode;
  onRemove: () => void;
  label: string;
  removable?: boolean;
}) {
  // Wonder's context chip (29, 51): 24px, bordered, raised fill. The remove button takes the icon's place on hover/focus,
  // so the chip never reserves blank space for it.
  return (
    <span
      className={cn(
        hook.mention,
        "group/chip flex h-6 max-w-full items-center gap-1.5 rounded-md border border-chat-chip-border bg-chat-chip-bg px-2 text-base leading-5.25 text-foreground-2",
      )}
    >
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span
          className={cn(
            "flex transition-opacity",
            removable && "group-hover/chip:opacity-0 group-focus-within/chip:opacity-0",
          )}
        >
          {icon}
        </span>
        {removable && (
          <span className="absolute inset-0 flex opacity-0 group-hover/chip:opacity-100 focus-within:opacity-100">
            <ChatIconButton
              size="xs"
              aria-label={`Remove ${label}`}
              onClick={onRemove}
              className="size-full"
            >
              <XIcon className="size-3.5" />
            </ChatIconButton>
          </span>
        )}
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The prompt text drawn behind the textarea (same box, font and wrapping) with picked commands as green badges. */
function PromptMirror({ text, mirrorRef }: { text: string; mirrorRef: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={mirrorRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden pt-2 pr-2.5 pb-1 pl-2.5 font-sans text-base leading-5.25 wrap-break-word whitespace-pre-wrap text-foreground"
    >
      {promptRuns(text).map((run, i) =>
        run.command ? (
          <span key={i} data-chat-command={run.command} className="text-success">
            {run.text}
          </span>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
      {/* A trailing newline still gets its line. */}
      {"\u200b"}
    </div>
  );
}

export function Composer({ state }: { state: ChatState }) {
  const { followUp } = useChatBehavior();
  const [empty, setEmpty] = useState(true);
  const [focused, setFocused] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [text, setText] = useState("");
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [blank, setBlank] = useState(true);
  const [dragging, setDragging] = useState(false);
  const draftTimer = useRef<number | undefined>(undefined);
  // Wonder uses one short prompt; the header's chat switcher already shows whether a repository is attached.
  const placeholder = "Describe what you want to do...";

  const promptSlot = useAdopt("project-prompt", (el) => {
    const prompt = el as HTMLTextAreaElement;
    prompt.className = PROMPT_CLASS;
    const sync = () => {
      const isEmpty = !prompt.value.trim();
      setEmpty(isEmpty);
      setBlank(!prompt.value);
      setText(prompt.value);
    };
    // Draft persistence (debounced): survives chat switches and reloads when the workspace supports it.
    const saveDraft = () => {
      const setDraft = workspace()?.setDraft;
      if (!setDraft) return;
      window.clearTimeout(draftTimer.current);
      draftTimer.current = window.setTimeout(() => setDraft(prompt.value), 400);
    };
    prompt.addEventListener("input", saveDraft);
    const focus = () => {
      setFocused(true);
      setModelOpen(false);
    };
    const blur = () => setFocused(false);
    // Backspace right after a command badge removes the whole command.
    const removeCommand = (event: KeyboardEvent) => {
      const caret = prompt.selectionStart;
      if (event.key !== "Backspace" || event.defaultPrevented || caret !== prompt.selectionEnd)
        return;
      const start = commandEndingAt(prompt.value, caret);
      if (start < 0) return;
      event.preventDefault();
      legacySet(prompt, prompt.value.slice(0, start) + prompt.value.slice(caret));
      prompt.setSelectionRange(start, start);
    };
    // Enter sends (the default way while a turn runs), Shift+Enter adds a line, ⌘↵ sends the other way. The @ and /
    // lists take Enter first in the capture phase; IME composition keeps its own Enter.
    const enterSends = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (prompt.value.trim()) document.getElementById("project-run")?.click();
    };
    const scroll = () => {
      if (mirrorRef.current) mirrorRef.current.scrollTop = prompt.scrollTop;
    };
    prompt.addEventListener("keydown", removeCommand);
    prompt.addEventListener("keydown", enterSends);
    prompt.addEventListener("scroll", scroll);
    setFocused(document.activeElement === prompt);
    prompt.addEventListener("input", sync);
    prompt.addEventListener("focus", focus);
    prompt.addEventListener("blur", blur);
    sync();
    return () => {
      prompt.removeEventListener("input", sync);
      prompt.removeEventListener("input", saveDraft);
      window.clearTimeout(draftTimer.current);
      prompt.removeEventListener("focus", focus);
      prompt.removeEventListener("blur", blur);
      prompt.removeEventListener("keydown", removeCommand);
      prompt.removeEventListener("keydown", enterSends);
      prompt.removeEventListener("scroll", scroll);
    };
  });
  const runSlot = useAdopt("project-run", (el) => {
    el.classList.remove("wp-send", "wp-icon-button");
    el.className =
      hook.send +
      " m-0 flex size-6 items-center justify-center rounded-md border-0 bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary-hover";
    el.setAttribute("aria-label", "Send");
    const close = () => setModelOpen(false);
    el.addEventListener("click", close);
    return () => el.removeEventListener("click", close);
  });
  // Seen in the capture phase, before the legacy Send handler reads the prompt (⌘↵ clicks it too).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.("#project-run")) moveCommandFirst();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  const cancelSlot = useAdopt("project-cancel", (el) => {
    el.className =
      hook.stop +
      " m-0 flex size-6 items-center justify-center rounded-md border-0 bg-accent p-0 text-foreground shadow-none hover:bg-row";
    el.setAttribute("aria-label", "Stop");
  });

  // Legacy code clears the prompt without an input event (after Send); re-read it on every state change.
  useEffect(() => {
    const prompt = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
    if (!prompt) return;
    setEmpty(!prompt.value.trim());
    setBlank(!prompt.value);
    setText(prompt.value);
    // The native placeholder is kept for assistive tech but drawn by the island (truncated, beside "⌘L to focus").
    prompt.placeholder = placeholder;
    // While a turn runs the arrow sends the follow-up the default way (Settings › Agents: Queue or Steer); ⌘↵ the other way.
    const run = document.getElementById("project-run");
    const steers = followUp === "steer";
    run?.setAttribute(
      "aria-label",
      state.busy ? (steers ? "Steer message" : "Queue message") : "Send",
    );
    run?.setAttribute(
      "title",
      state.busy
        ? steers
          ? "Send now to the running agent"
          : "Queue after the current turn"
        : "Send",
    );
  }, [state, placeholder, followUp]);

  // Restore the saved draft when switching conversations (never over text the user is typing).
  const conversationId = state.conversationId;
  useEffect(() => {
    const prompt = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
    const draft = workspace()?.getState().draft;
    if (prompt && draft && !prompt.value) {
      legacySet(prompt, draft);
      setEmpty(!draft.trim());
      setBlank(false);
      setText(draft);
    }
  }, [conversationId]);

  // With a command in the text the textarea's own glyphs hide and the mirror draws them; the caret stays.
  const hasCommand = promptRuns(text).some((run) => run.command);
  useEffect(() => {
    const prompt = document.getElementById("project-prompt");
    prompt?.classList.toggle("text-transparent", hasCommand);
    prompt?.classList.toggle("caret-foreground", hasCommand);
    if (hasCommand && mirrorRef.current && prompt) mirrorRef.current.scrollTop = prompt.scrollTop;
  }, [hasCommand, text]);

  const ws = workspace();
  const mentions = state.mentions ?? [];
  // Dropped images are saved by the desktop main process; the web chat takes text only.
  const canDrop = !WEB && !!ws?.attachImages;
  const hasFiles = (event: DragEvent) => canDrop && [...event.dataTransfer.types].includes("Files");
  // The secondary button sends the follow-up the other way from the default (same as ⌘↵).
  const otherWay = followUp === "steer" ? "queue" : "steer";
  const sendOther = otherWay === "steer" ? ws?.steer : ws?.queueMessage;
  const sendOtherWay = () => {
    const prompt = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
    const text = prompt?.value.trim();
    if (!prompt || !text || !sendOther) return;
    sendOther(commandFirst(text));
    legacySet(prompt, "");
    ws?.setDraft?.("");
    prompt.focus();
  };
  const canSendOther = state.busy && !empty && !!sendOther;
  return (
    <div
      className={cn(
        "relative mx-4 mb-4 flex shrink-0 flex-col rounded-2xl border border-card-border bg-card",
        dragging && "border-ring",
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget)
          document.getElementById("project-prompt")?.focus();
      }}
      onDragEnter={(event) => {
        if (hasFiles(event)) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        const images = [...event.dataTransfer.files].filter((file) =>
          file.type.startsWith("image/"),
        );
        if (images.length) ws?.attachImages?.(images);
      }}
    >
      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-2xl bg-card/90 text-base text-foreground-2"
        >
          <ImageIcon className="size-4 text-muted-foreground" />
          Drop images to attach
        </div>
      )}
      <MentionPopover />
      {!WEB && <SlashCommands state={state} />}
      <StylePicker />
      <WorkingDirectories state={state} />
      {(state.attachments.length > 0 || mentions.length > 0) && (
        <div
          className={cn(
            hook.mentions,
            "flex max-h-32 flex-wrap gap-1.5 overflow-y-auto px-2 pt-2 pb-1.5",
          )}
        >
          {mentions.map((mention) => (
            <Chip
              key={mention.id}
              label={mention.label}
              icon={
                mention.type ? (
                  <MentionIcon type={mention.type} />
                ) : (
                  <CircleDotIcon className="size-3.5 text-muted-foreground" />
                )
              }
              onRemove={() => ws?.removeMention?.(mention.id)}
              removable={!!ws?.removeMention}
            >
              {mention.type === "element" ? (
                <span className="text-primary-text">{mention.label}</span>
              ) : (
                mention.label
              )}
            </Chip>
          ))}
          {state.attachments.map((item, index) => (
            <Chip
              key={`${index}-${item.name}`}
              label={item.name}
              icon={
                item.kind === "image" ? (
                  <ImageIcon className="size-3.5 text-muted-foreground" />
                ) : (
                  <FileTextIcon className="size-3.5 text-muted-foreground" />
                )
              }
              onRemove={() => ws?.removeAttachment(index)}
            >
              {item.name}
            </Chip>
          ))}
        </div>
      )}
      <div className="relative">
        {hasCommand && <PromptMirror text={text} mirrorRef={mirrorRef} />}
        <div ref={promptSlot} className="contents" />
        {blank && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 flex gap-3 pt-2 pr-2 pl-2.5 text-base leading-5.25 text-subtle-foreground"
          >
            <span className="min-w-0 truncate">{placeholder}</span>
            {!focused && <span className="ml-auto shrink-0">⌘L to focus</span>}
          </div>
        )}
      </div>
      {!WEB && state.defaults.agent === "codex" && (
        <div
          data-chat-plan="chatgpt"
          className="flex items-center justify-between gap-2 px-2.5 pb-1 text-xs text-muted-foreground"
        >
          <span>Using ChatGPT plan</span>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() =>
              void platform.desktop?.openExternal("https://chatgpt.com/settings/usage")
            }
          >
            Manage usage
          </button>
        </div>
      )}
      <div className="flex h-7.5 items-center gap-0.5 px-1.5 pb-1.5">
        {/* Desktop-only: attachments from disk, agent tools/MCP status, account usage, autonomy (own capability). */}
        {!WEB && <AttachMenu state={state} />}
        <ModelMenu state={state} open={modelOpen} onOpenChange={setModelOpen} />
        <AccessMenu access={state.defaults.access} />
        <span className="flex-1" />
        <WorksWith state={state} />
        <AutonomyPopover state={state} />
        {!WEB && <ToolsPopover state={state} />}
        {!WEB && <UsageRing state={state} />}
        {canSendOther && (
          <button
            type="button"
            title={
              otherWay === "steer"
                ? "Send now to the running agent (⌘↵)"
                : "Queue after the current turn (⌘↵)"
            }
            onClick={sendOtherWay}
            className={cn(
              hook.steer,
              "ml-1 flex h-6 items-center rounded-md bg-accent px-2 text-sm text-foreground hover:bg-row",
            )}
          >
            {otherWay === "steer" ? "Steer" : "Queue"}
          </button>
        )}
        <span ref={cancelSlot} className={cn(hook.stopSlot, state.busy ? "ml-1 flex" : "hidden")} />
        <span
          ref={runSlot}
          className={cn(
            "ml-1 flex",
            state.busy && empty && "hidden",
            !state.busy && empty && "opacity-50",
          )}
        />
      </div>
    </div>
  );
}
