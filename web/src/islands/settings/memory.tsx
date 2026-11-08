import { useCodexConnection } from "./codex-connection";
// Settings › Memory (ref 75): design preferences, what each agent remembers (desktop/agent-memory.cjs),
// the home-folder instruction files chats load, personal instructions and VERYNIZE.md.
// Element ids #settings-memory, #settings-save-memory and #settings-design-preference-* are test contracts.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpenIcon, ExternalLinkIcon, FileTextIcon, FolderIcon } from "lucide-react";
import { toast } from "sonner";
import { ClaudeMark, CodexMark } from "@/components/icons";
import { DesignPreferencesSection } from "./agent-memory";
import { agentWorkspace, type SettingsApi } from "./api";
import { Card, IconTile, PageHeader, Row, Section, SettingsButton } from "./controls";
import { platform } from "@/lib/platform";

export type MemoryFile = { name: string; size: number; modified: number };
export type FileInfo = {
  path: string;
  displayPath: string;
  exists: boolean;
  size: number;
  modified: number | null;
};
export type Overview = {
  repoLess: { claude: { enabled: boolean; dir: string; displayDir: string; files: MemoryFile[] } };
  aboutYou: {
    codex: {
      enabled: boolean;
      configured: boolean;
      configPath: string;
      displayDir: string;
      exists: boolean;
      summaries: number;
      skills: number;
    };
    claude: {
      enabled: boolean;
      userMemory: FileInfo;
      autoMemoryDir: { path: string; displayPath: string; files: number } | null;
      projectsDir: string;
      projectsWithMemory: number;
    };
  };
  instructions: (FileInfo & {
    id: "codexAgents" | "claudeUser";
    agent: "codex" | "claude";
    readBy: string;
    sharedWith: string | null;
  })[];
};
export type Target = { kind: string; name?: string };
export type MemoryIpc = {
  overview(): Promise<Overview>;
  reveal(target: Target): Promise<unknown>;
  open(target: Target): Promise<unknown>;
};

const memoryIpc = (): MemoryIpc | null => {
  const ipc: Partial<MemoryIpc> | undefined = platform.desktop?.agentMemory;
  return ipc &&
    typeof ipc.overview === "function" &&
    typeof ipc.reveal === "function" &&
    typeof ipc.open === "function"
    ? (ipc as MemoryIpc)
    : null;
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    : String(error);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function AgentLabel({ agent, children }: { agent: "claude" | "codex"; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {agent === "claude" ? <ClaudeMark className="size-4" /> : <CodexMark className="size-4" />}
      {children}
    </span>
  );
}

function PathLine({ path, note }: { path: string; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 pb-3.5">
      <code data-memory-path className="font-mono text-xs break-all text-foreground-3">
        {path}
      </code>
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
    </div>
  );
}

/** A Card block (title + status, path, notes) — kept as one child so Card's separators fall between blocks. */
function MemoryBlock({
  status,
  action,
  children,
}: {
  status: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <Row title="Memory" description={<span data-memory-status>{status}</span>}>
        {action}
      </Row>
      {children}
    </div>
  );
}

export function MemoryView({ api }: { api: SettingsApi }) {
  const { connected: codexConnected } = useCodexConnection();
  const ipc = memoryIpc();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [text, setText] = useState(() => agentWorkspace()?.getDefaults?.().instructions ?? "");

  const reload = useCallback(async () => {
    if (!ipc) return;
    try {
      setOverview(await ipc.overview());
    } catch (error) {
      toast(message(error));
    }
  }, [ipc]);
  useEffect(() => {
    void reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  const act = (fn: () => Promise<unknown> | undefined) => async () => {
    try {
      await fn();
    } catch (error) {
      toast(message(error));
    }
    void reload();
  };
  const reveal = (target: Target) => act(() => ipc?.reveal(target));
  const open = (target: Target) => act(() => ipc?.open(target));
  const finder = (target: Target, label = "Show in Finder") => (
    <SettingsButton data-memory-reveal={target.kind} onClick={reveal(target)}>
      <FolderIcon />
      {label}
    </SettingsButton>
  );

  const repoLess = overview?.repoLess.claude;
  const codex = overview?.aboutYou.codex;
  const claude = overview?.aboutYou.claude;

  return (
    <>
      <PageHeader
        title="Memory"
        description="Agent memory stays on this computer and is shared by everyone who uses it. Design preferences, your visual taste, are kept on this computer by Verynize."
      />
      <div className="flex flex-col gap-12.5">
        <DesignPreferencesSection />

        {!ipc ? (
          <Section
            id="settings-agent-memory"
            title="Agent memory"
            description="What your agents remember between chats."
          >
            <Card>
              <Row
                title="Available in the desktop app"
                description="Agent memory lives in the Claude Code and Codex folders on this Mac."
              />
            </Card>
          </Section>
        ) : (
          <>
            <Section
              id="settings-memory-repoless"
              title="Chats without a repository"
              description="What each agent remembers for the chats you start without one."
            >
              <div className="mb-4.5 px-4 text-sm text-foreground">
                <AgentLabel agent="claude">Claude Code</AgentLabel>
              </div>
              <Card data-memory-card="repoless-claude">
                <MemoryBlock
                  status={repoLess ? (repoLess.enabled ? "On" : "Off") : "…"}
                  action={finder({ kind: "repoLess" })}
                >
                  {repoLess && (
                    <PathLine
                      path={repoLess.displayDir}
                      note="Shared by your chats without a repository"
                    />
                  )}
                </MemoryBlock>
                {repoLess && repoLess.files.length === 0 && (
                  <p data-memory-empty className="py-3.5 text-sm text-muted-foreground">
                    Nothing saved yet. Ask Claude Code to remember something in a chat here.
                  </p>
                )}
                {repoLess &&
                  repoLess.files.map((file) => (
                    <Row
                      key={file.name}
                      icon={<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />}
                      title={
                        <span data-memory-file className="font-mono text-xs">
                          {file.name}
                        </span>
                      }
                      description={`Updated ${new Date(file.modified).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                    >
                      <SettingsButton
                        variant="ghost"
                        onClick={open({ kind: "repoLessFile", name: file.name })}
                      >
                        Open
                        <ExternalLinkIcon />
                      </SettingsButton>
                    </Row>
                  ))}
              </Card>
            </Section>

            <Section
              id="settings-memory-about"
              title="About you"
              description="What your agents remember about you in every repository."
            >
              <div className="flex flex-col gap-4">
                {codexConnected && <Card data-memory-card="about-codex">
                  <div className="py-3 text-sm text-foreground-3">
                    <AgentLabel agent="codex">Codex</AgentLabel>
                  </div>
                  <MemoryBlock
                    status={
                      codex
                        ? codex.enabled
                          ? "On"
                          : "Off until you turn on features.memories"
                        : "…"
                    }
                    action={finder({ kind: "codexMemories" })}
                  >
                    {codex && (
                      <PathLine
                        path={codex.displayDir}
                        note={
                          <>
                            Codex’s own folder
                            <br />
                            {codex.enabled
                              ? "Codex writes summaries of past conversations and reusable skills here, and reads them when a chat starts."
                              : `Turn memories on in Codex with /memories, or set features.memories = true in ${codex.configPath}. In the EEA, the UK and Switzerland, Codex offers memories only after you opt in.`}
                          </>
                        }
                      />
                    )}
                  </MemoryBlock>
                  {codex && (
                    <p data-memory-counts="codex" className="py-3.5 text-sm text-muted-foreground">
                      {plural(codex.summaries, "conversation summary", "conversation summaries")} ·{" "}
                      {plural(codex.skills, "skill")}
                    </p>
                  )}
                </Card>}

                <Card data-memory-card="about-claude">
                  <div className="py-3 text-sm text-foreground-3">
                    <AgentLabel agent="claude">Claude Code</AgentLabel>
                  </div>
                  <MemoryBlock
                    status={
                      claude ? (claude.enabled ? "On" : "Off in your Claude Code settings") : "…"
                    }
                    action={
                      claude && (
                        <SettingsButton
                          data-memory-open="claudeUser"
                          onClick={open({ kind: "claudeUser" })}
                        >
                          {claude.userMemory.exists ? "Open in editor" : "Create"}
                          <ExternalLinkIcon />
                        </SettingsButton>
                      )
                    }
                  >
                    {claude && (
                      <PathLine
                        path={claude.userMemory.displayPath}
                        note={
                          claude.userMemory.exists
                            ? "Your user memory. Claude Code reads it in every repository."
                            : "Not created yet. Anything you put here, Claude Code reads in every repository."
                        }
                      />
                    )}
                  </MemoryBlock>
                  {claude && (
                    <Row
                      title={claude.autoMemoryDir ? "Auto memory folder" : "Auto memory"}
                      description={
                        claude.autoMemoryDir ? (
                          <>
                            <code className="font-mono text-xs break-all text-foreground-3">
                              {claude.autoMemoryDir.displayPath}
                            </code>
                            <br />
                            {plural(claude.autoMemoryDir.files, "saved memory", "saved memories")} ·
                            set by autoMemoryDirectory
                          </>
                        ) : (
                          <>
                            Each repository keeps its own notes in {claude.projectsDir}.{" "}
                            <span data-memory-counts="claude">
                              {plural(
                                claude.projectsWithMemory,
                                "repository has",
                                "repositories have",
                              )}{" "}
                              saved memories.
                            </span>
                          </>
                        )
                      }
                    >
                      {finder({
                        kind: claude.autoMemoryDir ? "claudeAutoMemory" : "claudeProjects",
                      })}
                    </Row>
                  )}
                </Card>
              </div>
            </Section>

            <Section
              id="settings-memory-instructions"
              title="Instructions your chats load"
              description="Files in your home folder that agents read when a chat starts. Edit them in your editor."
            >
              <Card>
                {(overview?.instructions ?? []).filter((file) => file.agent !== "codex" || codexConnected).map((file) => (
                  <Row
                    key={file.id}
                    icon={
                      <IconTile>
                        {file.agent === "claude" ? (
                          <ClaudeMark className="size-4" />
                        ) : (
                          <CodexMark className="size-4" />
                        )}
                      </IconTile>
                    }
                    title={
                      <code data-instructions-file={file.id} className="font-mono text-xs">
                        {file.displayPath}
                      </code>
                    }
                    description={[
                      `Read by ${file.readBy}`,
                      file.sharedWith && (codexConnected || !file.sharedWith.includes("Codex")) && `Verynize gives it to ${file.sharedWith} chats`,
                      !file.exists && "Not created yet",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <SettingsButton data-memory-open={file.id} onClick={open({ kind: file.id })}>
                      {file.exists ? "Open in editor" : "Create"}
                      <ExternalLinkIcon />
                    </SettingsButton>
                  </Row>
                ))}
              </Card>
            </Section>
          </>
        )}

        <Section
          id="settings-instructions"
          title="Personal instructions"
          description="Verynize adds these to every new agent chat."
        >
          <textarea
            id="settings-memory"
            aria-labelledby="settings-instructions-label"
            maxLength={12000}
            placeholder="Your preferred stack, design principles, and coding conventions…"
            className="min-h-45 resize-y rounded-2xl border border-card-border bg-card px-4 py-3.5 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-subtle-foreground focus:border-primary"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mt-4 flex justify-end">
            <SettingsButton
              id="settings-save-memory"
              variant="primary"
              onClick={() => api.actions.saveMemory(text)}
            >
              Save instructions
            </SettingsButton>
          </div>
        </Section>

        <Section
          id="settings-project-memory"
          title="Project memory"
          description="Stored in the selected project."
        >
          <Card>
            <Row
              icon={
                <IconTile>
                  <BookOpenIcon className="size-4" />
                </IconTile>
              }
              title="VERYNIZE.md"
              description="Project-specific guidance for agents working in this repository."
            >
              <SettingsButton id="settings-open-memory" onClick={api.actions.openMemory}>
                Edit project memory
                <ExternalLinkIcon />
              </SettingsButton>
            </Row>
          </Card>
        </Section>
      </div>
    </>
  );
}
