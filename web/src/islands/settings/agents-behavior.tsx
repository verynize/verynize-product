import { useCodexConnection } from "./codex-connection";
// Settings › Agents, lower half: Chat, Response preferences, Code attribution, Projects and worktrees, Mode for new
// chats and Allowed without asking. Values live in desktop/agent-behavior.cjs (window.desktop.agentBehavior); the
// Default mode is the chat defaults' access (same value as Default Models › Access). Ids are test contracts
// (tests/settings.cjs).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderIcon,
  HandIcon,
  LockOpenIcon,
  NavigationIcon,
  PencilIcon,
  SettingsIcon,
  Trash2Icon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClaudeMark, CodexMark, LogoIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  behaviorIpc,
  chooseBehaviorFolder,
  setBehavior,
  useBehavior,
  type Access,
  type AgentBehavior,
  type AllowGroup,
  type BehaviorPatch,
  type CommitAuthor,
  type OutputStyle,
} from "./behavior-store";
import {
  Card,
  CommitField,
  IconTile,
  NativeSelect,
  Row,
  Section,
  SettingsButton,
  Toggle,
} from "./controls";
import { platform } from "@/lib/platform";

const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    : String(error);
const save = (patch: BehaviorPatch) => setBehavior(patch).catch((error) => toast(message(error)));

/* ---------- Segmented control (Steer | Queue, Default | None) ---------- */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  name,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  name: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      className="flex items-center gap-0.5"
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          {...{ [`data-${name}`]: option.value }}
          className="h-6 rounded-md px-2 text-sm text-muted-foreground outline-none hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* ---------- Chat ---------- */
function ChatSection({ behavior }: { behavior: AgentBehavior }) {
  return (
    <Section id="settings-agent-chat" title="Chat">
      <Card>
        <Row
          title="Follow-up messages"
          description="Steer joins the current work, Queue waits until it’s done. ↵ sends this way, ⌘↵ the other way."
        >
          <div id="settings-follow-up">
            <Segmented
              label="Follow-up messages"
              name="follow-up"
              value={behavior.followUp}
              options={[
                { value: "steer", label: "Steer" },
                { value: "queue", label: "Queue" },
              ]}
              onChange={(followUp) => void save({ followUp })}
            />
          </div>
        </Row>
        <Row
          title="Expand agent work by default"
          description="Thinking and tool calls open unfolded instead of collapsed."
        >
          <Toggle
            id="settings-expand-work"
            aria-label="Expand agent work by default"
            checked={behavior.expandWork}
            onCheckedChange={(expandWork) => void save({ expandWork })}
          />
        </Row>
      </Card>
    </Section>
  );
}

/* ---------- Response preferences ---------- */
function ResponseSection({ behavior }: { behavior: AgentBehavior }) {
  const { connected: codexConnected } = useCodexConnection();
  const [styles, setStyles] = useState<{ styles: OutputStyle[]; current: string | null } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    behaviorIpc()
      ?.outputStyles()
      .then((value) => live && setStyles(value))
      .catch(() => live && setStyles({ styles: [], current: null }));
    return () => {
      live = false;
    };
  }, []);
  const list = styles?.styles ?? [];
  const chosen = behavior.claudeOutputStyle;
  return (
    <Section id="settings-response-preferences" title="Response preferences">
      <Card>
        <Row
          title="Claude response style"
          description="Applies from the next message."
          htmlFor="settings-claude-style"
        >
          <NativeSelect
            id="settings-claude-style"
            className="w-56"
            value={chosen}
            onChange={(event) => void save({ claudeOutputStyle: event.target.value })}
          >
            <option value="">
              Use my Claude Code setting{styles?.current ? ` (${styles.current})` : ""}
            </option>
            {list.map((style) => (
              <option key={style.id} value={style.id} title={style.description}>
                {style.name}
              </option>
            ))}
            {chosen && !list.some((style) => style.id === chosen) && (
              <option value={chosen}>{chosen}</option>
            )}
          </NativeSelect>
        </Row>
        {codexConnected && (
          <Row
            title="Codex personality"
            description="None turns personality off. Applies to new chats."
          >
            <div id="settings-codex-personality">
              <Segmented
                label="Codex personality"
                name="personality"
                value={behavior.codexPersonality}
                options={[
                  { value: "default", label: "Default" },
                  { value: "none", label: "None" },
                ]}
                onChange={(codexPersonality) => void save({ codexPersonality })}
              />
            </div>
          </Row>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Code attribution ---------- */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

function AttributionSection({
  behavior,
  author,
}: {
  behavior: AgentBehavior;
  author: CommitAuthor | null;
}) {
  const { connected: codexConnected } = useCodexConnection();
  const missing = author !== null && !author.name && !author.email;
  const warn = author?.linked === false && author.login;
  return (
    <Section id="settings-code-attribution" title="Code attribution">
      <Card>
        <div id="settings-commit-author" className="flex flex-col gap-3 py-3.5">
          <div className="flex flex-col gap-px">
            <div className="flex items-center gap-1.5 text-sm text-foreground">
              Commit author
              {warn && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-author-warning
                      aria-label={`Add this email to @${author.login} on GitHub to link these commits.`}
                      className="flex text-warning outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <TriangleAlertIcon className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Add this email to @{author.login} on GitHub to link these commits.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <span className="text-sm text-muted-foreground">
              {missing
                ? "No Git identity yet. Set user.name and user.email with git config --global."
                : "From your Git settings."}
            </span>
          </div>
          {author && !missing && (
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-avatar text-2xs font-medium text-avatar-foreground"
              >
                {initials(author.name || author.email)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span data-author-name className="truncate text-sm text-foreground">
                  {author.name || "No name set"}
                </span>
                <span data-author-email className="truncate text-sm text-muted-foreground">
                  {author.email || "No email set"}
                </span>
              </span>
            </div>
          )}
        </div>
        <Row
          title="Credit the agent on commits and pull requests"
          description={
            codexConnected
              ? "Adds Claude credit. Codex follows your ChatGPT setting."
              : "Adds Claude credit."
          }
        >
          <Toggle
            id="settings-credit-agent"
            aria-label="Credit the agent on commits and pull requests"
            checked={behavior.creditAgent}
            onCheckedChange={(creditAgent) => void save({ creditAgent })}
          />
        </Row>
      </Card>
    </Section>
  );
}

/* ---------- Projects and worktrees ---------- */
function ProjectsSection({ behavior, login }: { behavior: AgentBehavior; login: string | null }) {
  return (
    <Section id="settings-projects-worktrees" title="Projects and worktrees">
      <Card>
        <Row
          title="Verynize folder"
          align="start"
          description={
            <>
              <span id="settings-verynize-folder" className="block break-all">
                {behavior.displayFolder || behavior.defaultFolder || "~/Verynize"}
              </span>
              <span className="mt-3 block">
                New projects and worktrees go here. Existing ones stay where they are.
              </span>
            </>
          }
        >
          <SettingsButton
            id="settings-change-folder"
            onClick={() => void chooseBehaviorFolder().catch((error) => toast(message(error)))}
          >
            Change…
          </SettingsButton>
        </Row>
        <Row
          title="Branch prefix"
          description="New worktree branches start with this. Without one, they start with your GitHub username."
          htmlFor="settings-branch-prefix"
        >
          <CommitField
            id="settings-branch-prefix"
            className="w-64"
            spellCheck={false}
            autoComplete="off"
            placeholder={login?.toLowerCase() || "verynize"}
            value={behavior.branchPrefix}
            onCommit={(branchPrefix) => void save({ branchPrefix })}
          />
        </Row>
      </Card>
    </Section>
  );
}

/* ---------- Mode for new chats ---------- */
const MODES: { value: Access; label: string; Icon: LucideIcon }[] = [
  { value: "ask", label: "Ask", Icon: HandIcon },
  { value: "edit", label: "Edit", Icon: PencilIcon },
  { value: "auto", label: "Auto", Icon: NavigationIcon },
  { value: "full", label: "Full access", Icon: LockOpenIcon },
];
type Workspace = {
  getDefaults?(): { access?: string };
  setDefaults?(value: { access: string }): void;
};
const chatWorkspace = () => (window as unknown as { agentWorkspace?: Workspace }).agentWorkspace;
const LEGACY: Record<string, Access> = { "read-only": "ask", "workspace-write": "edit" };
const asAccess = (value: unknown): Access =>
  LEGACY[String(value)] ?? (MODES.some((m) => m.value === value) ? (value as Access) : "edit");

function ModeMenu({
  id,
  value,
  inherited,
  onChange,
}: {
  id: string;
  value: Access;
  inherited?: boolean;
  onChange: (value: Access | "default") => void;
}) {
  const mode = MODES.find((m) => m.value === value) ?? MODES[1];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <SettingsButton
          variant={inherited ? "ghost" : "secondary"}
          data-mode-repo={id}
          data-mode={value}
          aria-label={`Mode for ${id === "default" ? "new chats" : "this repository"}: ${mode.label}${inherited ? " (default)" : ""}`}
        >
          <mode.Icon />
          {mode.label}
          <ChevronDownIcon className="size-3" />
        </SettingsButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onEscapeKeyDown={(event) => event.stopPropagation()}>
        <DropdownMenuRadioGroup
          value={inherited ? "default" : value}
          onValueChange={(next) => onChange(next as Access | "default")}
        >
          {id !== "default" && (
            <>
              <DropdownMenuRadioItem value="default">Use default</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
            </>
          )}
          {MODES.map(({ value: option, label, Icon }) => (
            <DropdownMenuRadioItem key={option} value={option} data-mode-option={option}>
              <Icon className="size-3.5 text-foreground-3" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Repository = { id: string; name: string; root: string };
function ModesSection({ behavior }: { behavior: AgentBehavior }) {
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [fallback, setFallback] = useState<Access>(() =>
    asAccess(chatWorkspace()?.getDefaults?.().access),
  );
  useEffect(() => {
    const repositories = platform.desktop?.repositories;
    if (!repositories) return setRepositories([]);
    let live = true;
    repositories
      .list()
      .then((value) => live && setRepositories(value?.repositories ?? []))
      .catch(() => live && setRepositories([]));
    return () => {
      live = false;
    };
  }, []);
  const setDefault = (value: Access | "default") => {
    if (value === "default") return;
    const ws = chatWorkspace();
    if (!ws?.setDefaults) return toast("Open the chat once to change the default mode");
    ws.setDefaults({ access: value });
    setFallback(asAccess(ws.getDefaults?.().access ?? value));
  };
  const tile = (children: ReactNode) => <IconTile>{children}</IconTile>;
  return (
    <Section
      id="settings-chat-modes"
      title="Mode for new chats"
      description="Repositories without a pick of their own follow the default."
    >
      <Card>
        <Row icon={tile(<SettingsIcon className="size-4" />)} title="Default">
          <ModeMenu id="default" value={fallback} onChange={setDefault} />
        </Row>
        {(repositories ?? []).map((repo) => {
          const own = behavior.repoModes[repo.id];
          return (
            <Row
              key={repo.id}
              icon={tile(<FolderIcon className="size-4" />)}
              title={<span title={repo.root}>{repo.name}</span>}
            >
              <ModeMenu
                id={repo.id}
                value={own ?? fallback}
                inherited={!own}
                onChange={(value) =>
                  void save({ repoModes: { [repo.id]: value === "default" ? null : value } })
                }
              />
            </Row>
          );
        })}
      </Card>
    </Section>
  );
}

/* ---------- Allowed without asking ---------- */
const AGENT_LABEL: Record<AllowGroup["agent"], string> = {
  verynize: "Verynize",
  claude: "Claude Code",
  codex: "Codex",
};
function AgentGlyph({ agent, className }: { agent: AllowGroup["agent"]; className: string }) {
  if (agent === "claude") return <ClaudeMark className={className} />;
  if (agent === "codex") return <CodexMark className={className} />;
  return <LogoIcon className={className} />;
}

function AllowedSection() {
  const { connected: codexConnected } = useCodexConnection();
  const ipc = behaviorIpc();
  const [groups, setGroups] = useState<AllowGroup[] | null>(null);
  const [busy, setBusy] = useState("");
  const reload = useCallback(async () => {
    if (!ipc) return;
    try {
      setGroups(await ipc.allowList());
    } catch (error) {
      setGroups([]);
      toast(message(error));
    }
  }, [ipc]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const remove = async (id: string) => {
    if (!ipc) return;
    setBusy(id);
    try {
      await ipc.allowRemove(id);
      toast("Rule removed. The agent will ask again.");
    } catch (error) {
      toast(message(error));
    } finally {
      setBusy("");
    }
    await reload();
  };
  return (
    <Section
      id="settings-allowed-without-asking"
      title="Allowed without asking"
      description="Rules saved with “don’t ask again” in Verynize and your connected agents. Remove one and the agent asks again."
    >
      <div id="settings-allow-groups" className="flex flex-col gap-4">
        {!ipc && (
          <Card>
            <Row
              title="Available in the desktop app"
              description="Saved rules are read from this computer."
            />
          </Card>
        )}
        {ipc &&
          groups?.filter((group) => group.agent !== "codex" || codexConnected).length === 0 && (
            <Card>
              <Row
                title="No saved rules"
                description="When an agent asks for permission, choose “don’t ask again” to skip the question next time."
              />
            </Card>
          )}
        {(groups ?? [])
          .filter((group) => group.agent !== "codex" || codexConnected)
          .map((group) => (
            <Card
              key={group.id}
              data-allow-group={group.agent}
              data-allow-scope={group.scope}
              className="px-0"
            >
              <div className="flex items-center gap-3 rounded-t-2xl bg-background px-4 py-3">
                <IconTile>
                  <AgentGlyph agent={group.agent} className="size-4" />
                </IconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-sm text-foreground">
                    {group.global ? "Every repository" : group.scope}
                  </span>
                  <span
                    className="flex items-center gap-1.5 text-sm text-muted-foreground"
                    title={group.file}
                  >
                    <AgentGlyph agent={group.agent} className="size-3.5" />
                    {AGENT_LABEL[group.agent]}
                  </span>
                </div>
                <SettingsButton
                  variant="ghost"
                  data-allow-open
                  onClick={() =>
                    void ipc?.allowOpen(group.id).catch((error) => toast(message(error)))
                  }
                >
                  <ExternalLinkIcon />
                  Open in editor
                </SettingsButton>
              </div>
              {group.rules.map((rule) => (
                <div
                  key={rule.id}
                  data-allow-rule={rule.raw}
                  className="mx-4 flex items-center gap-3 py-3.5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm break-words text-foreground">{rule.title}</span>
                    <code className="font-mono text-xs break-all text-muted-foreground">
                      {rule.raw}
                    </code>
                  </div>
                  <SettingsButton
                    variant="ghost"
                    className="w-7 px-0"
                    data-allow-remove
                    disabled={busy === rule.id}
                    aria-label={`Remove “${rule.title}”`}
                    onClick={() => void remove(rule.id)}
                  >
                    <Trash2Icon />
                  </SettingsButton>
                </div>
              ))}
            </Card>
          ))}
      </div>
    </Section>
  );
}

/** Lower half of Settings › Agents. */
export function AgentBehaviorSections() {
  const behavior = useBehavior();
  const [author, setAuthor] = useState<CommitAuthor | null>(null);
  useEffect(() => {
    let live = true;
    behaviorIpc()
      ?.commitAuthor()
      .then((value) => live && setAuthor(value))
      .catch(() => live && setAuthor({ name: "", email: "", login: null, linked: null }));
    return () => {
      live = false;
    };
  }, []);
  const desktop = !!behaviorIpc();
  return (
    <div className={cn("flex flex-col gap-12.5")}>
      {!desktop && (
        <Section id="settings-agent-behavior" title="Chat">
          <Card>
            <Row
              title="Available in the desktop app"
              description="These settings apply to the agents installed on this computer."
            />
          </Card>
        </Section>
      )}
      {desktop && (
        <>
          <ChatSection behavior={behavior} />
          <ResponseSection behavior={behavior} />
          <AttributionSection behavior={behavior} author={author} />
          <ProjectsSection behavior={behavior} login={author?.login ?? null} />
          <ModesSection behavior={behavior} />
        </>
      )}
      <AllowedSection />
    </div>
  );
}
