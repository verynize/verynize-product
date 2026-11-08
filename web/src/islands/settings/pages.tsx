import { ImportGenerationSection } from "./import-generation";
import { useCodexConnection } from "./codex-connection";
// One component per settings section. Element ids and data attributes are test contracts (tests/settings.cjs).
import { useEffect, useState, type ReactNode } from "react";
import { CopyIcon, ExternalLinkIcon, GaugeIcon, GlobeIcon, ServerIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FigmaIcon } from "@/components/icons";
import { AdvancedSection, ChatSoundRow } from "./preferences-extra";
import { TelemetrySection } from "./telemetry";
import { useToolsInfo } from "./agent-memory";
import { AgentAccessSection, AgentToolsSection, ProviderAccountList } from "./agents-tools";
import { AgentBehaviorSections } from "./agents-behavior";
import { OpenRouterSection } from "./openrouter";
import { MemoryView } from "./memory";
import { UsageView } from "./usage";
import { agentWorkspace, type AgentInfo, type Preferences, type SettingsApi } from "./api";
import {
  Card,
  ChoiceTile,
  CommitField,
  IconTile,
  NativeSelect,
  PageHeader,
  Row,
  Section,
  SettingsButton,
  TextField,
  Toggle,
} from "./controls";

type PageProps = {
  api: SettingsApi;
  preferences: Preferences;
  setPreference(changes: Partial<Preferences>): void;
  accounts: Record<string, string>;
};

function Pages({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-12.5">{children}</div>;
}

/* ---------- Account (61) ---------- */
export function AccountPage({ preferences, setPreference }: PageProps) {
  const name = preferences.displayName || "Personal workspace";
  return (
    <>
      <PageHeader title="Account" />
      <Pages>
        <Section id="settings-profile" title="Profile">
          <Card>
            <Row title="Avatar" description="Shown next to your cursor in shared rooms.">
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full bg-primary-tint text-lg font-medium text-primary-text"
              >
                {name.trim().charAt(0).toUpperCase() || "P"}
              </span>
            </Row>
            <Row
              title="Display name"
              description="Used for this local workspace and collaboration presence."
              htmlFor="settings-display-name"
            >
              <CommitField
                id="settings-display-name"
                data-pref="displayName"
                maxLength={80}
                className="w-64.5"
                value={preferences.displayName ?? ""}
                onCommit={(value) => setPreference({ displayName: value.trim() })}
              />
            </Row>
          </Card>
        </Section>
        <Section
          id="settings-storage"
          title="Storage"
          description="Verynize does not need a hosted account."
        >
          <Card>
            <Row
              title="Stored on this device"
              description="Your designs and preferences stay on this computer. Shared rooms use private invite links."
            >
              <span className="text-sm text-muted-foreground">Local</span>
            </Row>
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Preferences (70) ---------- */
function ThemePreview({ theme }: { theme: "system" | "light" | "dark" }) {
  const card = (tone: "light" | "dark") => (
    <span
      className={cn(
        "absolute inset-x-2 top-6 bottom-0 rounded-t-md",
        tone === "light" ? "bg-preview-light-card" : "bg-preview-dark-card",
      )}
    >
      <span
        className={cn(
          "absolute top-2.5 left-3 h-1 w-6 rounded-full",
          tone === "light" ? "bg-preview-light-bar" : "bg-preview-dark-bar",
        )}
      />
      <span
        className={cn(
          "absolute top-2.5 right-3 size-1 rounded-full",
          tone === "light" ? "bg-preview-light-bar" : "bg-preview-dark-bar",
        )}
      />
    </span>
  );
  if (theme === "system")
    return (
      <>
        <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-preview-light">
          <span className="absolute inset-y-0 left-0 w-17.5">{card("light")}</span>
        </span>
        <span className="absolute inset-y-0 right-0 w-1/2 overflow-hidden bg-preview-dark">
          <span className="absolute inset-y-0 right-0 w-17.5">{card("dark")}</span>
        </span>
      </>
    );
  return (
    <span
      className={cn("absolute inset-0", theme === "light" ? "bg-preview-light" : "bg-preview-dark")}
    >
      {card(theme)}
    </span>
  );
}

function SelectionPreview({ deep }: { deep: boolean }) {
  return (
    <span className="absolute inset-0 bg-background">
      <span
        className={cn(
          "absolute inset-x-2 inset-y-2 rounded-md bg-muted",
          !deep && "outline outline-1 outline-foreground-3",
        )}
      >
        <span className="absolute top-1.5 left-1.5 h-0.5 w-3 rounded-full bg-subtle-foreground" />
        <span className="absolute inset-x-1.5 top-4 h-2 rounded-sm bg-accent" />
        <span
          className={cn(
            "absolute inset-x-1.5 bottom-1.5 flex h-2.5 items-center justify-center rounded-sm bg-accent",
            deep && "outline outline-1 outline-foreground-3",
          )}
        >
          <span className="size-1 rounded-full bg-subtle-foreground" />
        </span>
      </span>
    </span>
  );
}

export function PreferencesPage({ preferences, setPreference }: PageProps) {
  const themes = ["system", "light", "dark"] as const;
  return (
    <>
      <PageHeader title="Preferences" />
      <Pages>
        <Section id="settings-notifications" title="Notifications">
          <Card>
            <ChatSoundRow preferences={preferences} setPreference={setPreference} />
            <Row
              title="Desktop notifications"
              description="Alerts when a chat finishes or needs you."
            >
              <Toggle
                aria-label="Desktop notifications"
                data-pref="notifications"
                checked={Boolean(preferences.notifications)}
                onCheckedChange={(checked) => setPreference({ notifications: checked })}
              />
            </Row>
          </Card>
        </Section>

        <Section id="settings-appearance" title="Appearance">
          <Card>
            <Row title="Theme" description="System follows your device’s appearance." align="start">
              <div role="group" aria-label="Theme" className="mt-1 mr-1 flex gap-5">
                {themes.map((theme) => (
                  <ChoiceTile
                    key={theme}
                    data-theme={theme}
                    selected={preferences.theme === theme}
                    label={theme[0].toUpperCase() + theme.slice(1)}
                    onClick={() => setPreference({ theme })}
                  >
                    <ThemePreview theme={theme} />
                  </ChoiceTile>
                ))}
              </div>
            </Row>
            <Row
              title="Reduce motion"
              description="Pause animated gradients and use calmer transitions."
            >
              <Toggle
                aria-label="Reduce motion"
                data-pref="reduceMotion"
                checked={Boolean(preferences.reduceMotion)}
                onCheckedChange={(checked) => setPreference({ reduceMotion: checked })}
              />
            </Row>
          </Card>
        </Section>

        <Section id="settings-canvas" title="Canvas">
          <Card>
            <Row
              title="Selection behavior"
              description="Classic selects the outermost frame you click inside. Deep selects the innermost one."
              align="start"
            >
              <div role="group" aria-label="Selection behavior" className="mt-1 mr-1 flex gap-5">
                {(["classic", "deep"] as const).map((mode) => (
                  <ChoiceTile
                    key={mode}
                    data-selection={mode}
                    selected={preferences.selection === mode}
                    label={mode === "classic" ? "Classic" : "Deep"}
                    onClick={() => setPreference({ selection: mode })}
                  >
                    <SelectionPreview deep={mode === "deep"} />
                  </ChoiceTile>
                ))}
              </div>
            </Row>
            <Row
              title="Small nudge"
              description="How far an arrow key moves a layer, in pixels."
              htmlFor="settings-small-nudge"
            >
              <CommitField
                id="settings-small-nudge"
                data-pref="smallNudge"
                type="number"
                min={0.1}
                max={1000}
                step={0.1}
                className="w-24"
                value={preferences.smallNudge}
                onCommit={(value) => setPreference({ smallNudge: Number(value) })}
              />
            </Row>
            <Row
              title="Large nudge"
              description="How far an arrow key moves a layer with Shift held, in pixels."
              htmlFor="settings-large-nudge"
            >
              <CommitField
                id="settings-large-nudge"
                data-pref="largeNudge"
                type="number"
                min={0.1}
                max={1000}
                step={0.1}
                className="w-24"
                value={preferences.largeNudge}
                onCommit={(value) => setPreference({ largeNudge: Number(value) })}
              />
            </Row>
          </Card>
        </Section>

        <ImportGenerationSection />

        <AdvancedSection preferences={preferences} setPreference={setPreference} />

        <TelemetrySection />
      </Pages>
    </>
  );
}

/* ---------- Agents (71) ---------- */
export function AgentsPage({ api, accounts }: PageProps) {
  const { connected: codexConnected } = useCodexConnection();
  const tools = useToolsInfo();
  const [agents, setAgents] = useState<AgentInfo[] | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.actions
      .discoverAgents()
      .then((list) => live && setAgents(list))
      .catch((e: Error) => live && (setError(e.message), setAgents([])));
    return () => {
      live = false;
    };
  }, [api]);
  return (
    <>
      <PageHeader title="Agents" />
      <Pages>
        <Section
          id="settings-providers"
          title="Provider accounts"
          description="Connect the accounts your agents use."
          action={
            <SettingsButton onClick={() => api.select("usage")}>
              <GaugeIcon />
              View usage
            </SettingsButton>
          }
        >
          <ProviderAccountList api={api} agents={agents} error={error} accounts={accounts} />
        </Section>
        <OpenRouterSection />
        <AgentToolsSection />
        <AgentAccessSection />
        <Section
          id="settings-agent-runtime"
          title="How agents run"
          description={
            codexConnected
              ? "Claude runs through your Claude Code install. Codex runs locally through app-server using your ChatGPT connection."
              : "Claude runs through the Claude Agent SDK on your Claude Code install."
          }
        >
          <Card>
            <Row
              title="Agent workspace"
              description="Connected agents get the live canvas tools while the Verynize MCP bridge is running."
            >
              <SettingsButton id="settings-open-agent" onClick={api.actions.openAgent}>
                Open agent workspace
                <ExternalLinkIcon />
              </SettingsButton>
            </Row>
          </Card>
        </Section>
        <Section
          id="settings-agent-about"
          title="About"
          description="The design tool set agents use on the canvas."
        >
          <Card>
            <Row
              title="Design tools version"
              description={
                tools?.toolsVersion
                  ? `Verynize MCP ${tools.serverVersion ?? ""} · changes whenever the tools, codec or design knowledge change.`
                  : "Shown once the live MCP bridge is running."
              }
            >
              <code id="settings-tools-version" className="font-mono text-xs text-foreground-3">
                {tools?.toolsVersion ?? "—"}
              </code>
            </Row>
          </Card>
        </Section>
        <AgentBehaviorSections />
      </Pages>
    </>
  );
}

/* ---------- Usage (72): settings/usage.tsx ---------- */
export function UsagePage() {
  return <UsageView />;
}

/* ---------- Default Models (73) ---------- */
export function ModelsPage({ api }: PageProps) {
  const { ready, connected: codexConnected } = useCodexConnection();
  const initial = agentWorkspace()?.getDefaults?.() ?? {};
  const legacyAccess: Record<string, string> = { "read-only": "ask", "workspace-write": "edit" };
  const [agent, setAgent] = useState(initial.agent || "codex");
  const [model, setModel] = useState(initial.model || "");
  const [effort, setEffort] = useState(initial.effort || "");
  useEffect(() => {
    if (ready && !codexConnected && agent === "codex") {
      setAgent("claude");
      setModel("");
      setEffort("");
    }
  }, [ready, codexConnected, agent]);
  const effectiveAgent = agent === "codex" && !codexConnected ? "claude" : agent;
  const effectiveModel = effectiveAgent === agent ? model : "";
  const effectiveEffort = effectiveAgent === agent ? effort : "";
  const [access, setAccess] = useState(
    legacyAccess[initial.access ?? ""] || initial.access || "edit",
  );
  return (
    <>
      <PageHeader title="Default Models" />
      <Pages>
        <Section
          id="settings-default-models"
          title="Your default model"
          description="Choose your agent and model. Leave the model blank to use the CLI’s configured default."
        >
          <Card>
            <Row
              title="Agent"
              description="Provider for new tasks."
              htmlFor="settings-default-agent"
            >
              <NativeSelect
                id="settings-default-agent"
                className="w-44"
                value={effectiveAgent}
                onChange={(event) => setAgent(event.target.value)}
              >
                {codexConnected && <option value="codex">Codex</option>}
                <option value="claude">Claude</option>
              </NativeSelect>
            </Row>
            <Row
              title="Model"
              description="Enter a model ID supported by your account."
              htmlFor="settings-default-model"
            >
              <TextField
                id="settings-default-model"
                className="w-44"
                placeholder="CLI default"
                value={effectiveModel}
                onChange={(event) => setModel(event.target.value)}
              />
            </Row>
            <Row
              title="Reasoning effort"
              description="Applied where supported by the chosen CLI."
              htmlFor="settings-default-effort"
            >
              <NativeSelect
                id="settings-default-effort"
                className="w-44"
                value={effectiveEffort}
                onChange={(event) => setEffort(event.target.value)}
              >
                {["", "low", "medium", "high", "xhigh", "max"].map((value) => (
                  <option key={value} value={value}>
                    {value || "Default"}
                  </option>
                ))}
              </NativeSelect>
            </Row>
            <Row
              title="Access"
              description="Ask approves each action in chat; Edit auto-approves file edits; Auto lets the provider reviewer decide; Full never asks."
              htmlFor="settings-default-access"
            >
              <NativeSelect
                id="settings-default-access"
                className="w-44"
                value={access}
                onChange={(event) => setAccess(event.target.value)}
              >
                <option value="ask">Ask</option>
                <option value="edit">Edit</option>
                <option value="auto">Auto</option>
                <option value="full">Full access</option>
              </NativeSelect>
            </Row>
          </Card>
          <div className="mt-4 flex justify-end">
            <SettingsButton
              id="settings-save-models"
              variant="primary"
              onClick={() =>
                api.actions.saveModels({
                  agent: effectiveAgent,
                  model: effectiveModel.trim(),
                  effort: effectiveEffort,
                  access,
                })
              }
            >
              Save defaults
            </SettingsButton>
          </div>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Connections (74) ---------- */
export function ConnectionsPage({ api, preferences }: PageProps) {
  const [cloud, setCloud] = useState(preferences.cloudServer ?? "");
  return (
    <>
      <PageHeader title="Connections" />
      <Pages>
        <Section id="settings-connections-design" title="Design">
          <Card>
            <Row
              icon={
                <IconTile>
                  <FigmaIcon className="size-4" />
                </IconTile>
              }
              title="Figma"
              description="Import links, .fig files and pasted layers; connect your account with your own OAuth client ID."
            >
              <SettingsButton id="settings-figma" onClick={api.actions.openFigma}>
                <FigmaIcon />
                Import & account
              </SettingsButton>
            </Row>
          </Card>
        </Section>
        <Section id="settings-connections-sharing" title="Sharing">
          <Card>
            <Row
              icon={
                <IconTile>
                  <GlobeIcon className="size-4" />
                </IconTile>
              }
              title="Cloudflare workspace"
              description="Origin serving your shared design rooms."
              htmlFor="settings-cloud"
            >
              <TextField
                id="settings-cloud"
                className="w-56"
                placeholder="https://your-app.workers.dev"
                value={cloud}
                onChange={(event) => setCloud(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && api.actions.saveCloud(cloud)}
              />
              <SettingsButton id="settings-save-cloud" onClick={() => api.actions.saveCloud(cloud)}>
                Save
              </SettingsButton>
            </Row>
          </Card>
        </Section>
        <Section id="settings-connections-mcp" title="MCP">
          <Card>
            <Row
              icon={
                <IconTile>
                  <ServerIcon className="size-4" />
                </IconTile>
              }
              title="Design MCP"
              description={
                <>
                  Use the local design server from your preferred agent:{" "}
                  <code className="font-mono text-xs text-foreground-3">
                    npm run mcp -- --root /absolute/design-folder
                  </code>
                </>
              }
            >
              <SettingsButton id="settings-mcp-copy" onClick={() => void api.actions.copyMcp()}>
                <CopyIcon />
                Copy command
              </SettingsButton>
            </Row>
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Memory (75): settings/memory.tsx ---------- */
export function MemoryPage({ api }: PageProps) {
  return <MemoryView api={api} />;
}
