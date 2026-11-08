// "Bring your own agent": connects the Claude Code / Codex CLIs installed on this computer. The
// list and sign-in come from the same IPC as Settings › Agents (desktop/agent-tools.cjs accounts,
// desktop/agent-auth.cjs login), so what is connected here is what chats use.
import { useCallback, useEffect, useState } from "react";
import { CircleCheckIcon, ExternalLinkIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClaudeMark, CodexMark, CursorMark } from "@/components/icons";
import { cn } from "@/lib/utils";
import { platform } from "@/lib/platform";

type ProviderAccount = { email?: string; organization?: string; plan?: string };
type Provider = {
  id: string;
  name: string;
  installed: boolean;
  loggedIn: boolean;
  comingSoon?: boolean;
  accounts: ProviderAccount[];
};
const desktop = () => platform.desktop;

const SHOWN = ["claude", "codex", "cursor"];
const MARKS: Record<string, (props: { className?: string }) => React.ReactNode> = {
  claude: ClaudeMark,
  codex: CodexMark,
  cursor: CursorMark,
};
const INSTALL: Record<string, string> = {
  claude: "https://docs.claude.com/en/docs/claude-code/setup",
  codex: "https://github.com/openai/codex",
};

export function AgentsStep({ onContinue }: { onContinue: () => void }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reload = useCallback(async () => {
    const list =
      (await desktop()
        ?.agentTools?.accounts()
        .catch(() => null)) ?? null;
    setProviders((list ?? []).filter((item) => SHOWN.includes(item.id)));
  }, []);
  useEffect(() => {
    void reload();
    return desktop()?.onAuthEvent?.((event) => {
      if (event.profile) return;
      if (event.type === "started" || event.type === "waiting") {
        setPending((p) => ({ ...p, [event.agent]: event.id }));
        return;
      }
      setPending((p) => {
        const { [event.agent]: _, ...rest } = p;
        return rest;
      });
      if (event.type === "error")
        setErrors((e) => ({ ...e, [event.agent]: event.message || "Sign-in failed" }));
      void reload();
    });
  }, [reload]);

  const connect = async (agent: string) => {
    setErrors((e) => ({ ...e, [agent]: "" }));
    try {
      await desktop()?.startAgentLogin?.({ agent });
    } catch (error) {
      setErrors((e) => ({ ...e, [agent]: error instanceof Error ? error.message : String(error) }));
    }
  };
  const anyConnected = providers?.some((p) => p.loggedIn) ?? false;

  return (
    <div className="flex w-full max-w-lg flex-col items-center">
      <div className="flex items-center" aria-hidden="true">
        {SHOWN.map((id, index) => {
          const Mark = MARKS[id];
          return (
            <span
              key={id}
              className={cn(
                "flex size-11 items-center justify-center rounded-full border border-card-border bg-background",
                index > 0 && "-ml-2",
              )}
            >
              <Mark className="size-5" />
            </span>
          );
        })}
      </div>
      <h1 className="mt-5 text-xl font-medium text-foreground">Bring your own agent</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
        Verynize chats run on the coding agent you already use, Claude Code or Codex, on this
        computer, with your own MCP servers, skills and subscription.
      </p>

      <ul
        id="onboarding-agents"
        aria-busy={providers === null}
        className="mt-10 w-full divide-y divide-border overflow-hidden rounded-xl border border-card-border bg-card"
      >
        {providers === null ? (
          <li className="flex h-14 items-center justify-center text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            <span className="ml-2">Looking for installed agents…</span>
          </li>
        ) : (
          SHOWN.map((id) => {
            const provider = providers.find((p) => p.id === id);
            const Mark = MARKS[id];
            const email = provider?.accounts[0]?.email || provider?.accounts[0]?.plan || "";
            const name = provider?.name ?? (id === "cursor" ? "Cursor" : id);
            return (
              <li key={id} data-agent={id} className="flex min-h-14 items-center gap-4 px-5 py-3">
                <Mark className="size-5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-foreground">{name}</div>
                  {provider?.loggedIn && email ? (
                    <div className="truncate text-sm text-muted-foreground">{email}</div>
                  ) : null}
                  {errors[id] ? <div className="text-xs text-destructive">{errors[id]}</div> : null}
                </div>
                <AgentStatus
                  id={id}
                  provider={provider}
                  pending={!!pending[id]}
                  onConnect={() => void connect(id)}
                  onCancel={() => void desktop()?.cancelAgentLogin?.({ id: pending[id] })}
                />
              </li>
            );
          })
        )}
      </ul>
      <div className="mt-3 flex w-full justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reload()}
          aria-label="Check agents again"
        >
          <RotateCwIcon />
          Check again
        </Button>
      </div>

      <Button id="onboarding-continue" className="mt-8" onClick={onContinue}>
        {anyConnected ? "Continue" : "Continue without an agent"}
      </Button>
    </div>
  );
}

function AgentStatus({
  id,
  provider,
  pending,
  onConnect,
  onCancel,
}: {
  id: string;
  provider: Provider | undefined;
  pending: boolean;
  onConnect: () => void;
  onCancel: () => void;
}) {
  if (!provider || provider.comingSoon)
    return (
      <span className="rounded-md border border-edge px-2 py-0.5 text-xs text-muted-foreground">
        Coming soon
      </span>
    );
  if (provider.loggedIn)
    return (
      <span className="flex items-center gap-1.5 text-sm text-success" data-status="connected">
        <CircleCheckIcon className="size-4" />
        Connected
      </span>
    );
  if (pending)
    return (
      <span className="flex items-center gap-2" data-status="pending">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          Finish in your browser…
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    );
  if (!provider.installed)
    return (
      <Button
        variant="outline"
        size="sm"
        data-status="missing"
        onClick={() => void desktop()?.openExternal?.(INSTALL[id])}
      >
        Install
        <ExternalLinkIcon className="size-3" />
      </Button>
    );
  return (
    <Button
      variant="secondary"
      size="sm"
      data-status="signed-out"
      data-oai-siwc-button={id === "codex" ? "" : undefined}
      onClick={onConnect}
    >
      {id === "codex" ? "Continue with ChatGPT" : "Connect"}
    </Button>
  );
}
