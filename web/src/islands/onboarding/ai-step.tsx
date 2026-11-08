// Web AI setup (onboarding.tsx shows it after the first web sign-in, and Settings › Agents reopens it): the web chat
// runs on the account's own OpenRouter credential (lib/ai-credentials.ts, the same connect controls as the chat gate,
// chat/web-gate.tsx), while Claude Code and Codex sign-ins belong to the desktop app. Two steps: connect, then a
// summary. Test contract: `#onboarding-ai-providers li[data-provider][data-status]`, `#onboarding-ai-status`,
// `#onboarding-openrouter-connect-openrouter`, `#onboarding-openrouter-paste-key`, `#onboarding-openrouter-openrouter-key`,
// `#onboarding-openrouter-save-key`, `#onboarding-openrouter-key-error`, `#onboarding-ai-continue`, `#onboarding-ai-skip`,
// `#onboarding-ai-off`, `#onboarding-ready-summary`, `#onboarding-ready-done`.
import { useQuery } from "@tanstack/react-query";
import { CircleCheckIcon, KeyRoundIcon, LoaderCircleIcon, MonitorIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClaudeMark, CodexMark } from "@/components/icons";
import { aiConfigQuery, webAgentScope } from "@/lib/agent-transport";
import { aiCredentialsQuery, type OpenRouterCredential } from "@/lib/ai-credentials";
import { useCloudAccount } from "@/lib/cloud-account";
import { SIGNED_OUT } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { OpenRouterConnect } from "../chat/web-gate";
import { describe } from "../settings/openrouter";

/** The account's OpenRouter credential and the server's model API switch, from the shared query cache. */
function useAiStatus() {
  const scope = webAgentScope(useCloudAccount());
  const credentials = useQuery({ ...aiCredentialsQuery(scope ?? SIGNED_OUT), enabled: !!scope });
  const config = useQuery({ ...aiConfigQuery(scope ?? SIGNED_OUT), enabled: !!scope });
  const credential: OpenRouterCredential | undefined = credentials.data?.openrouter;
  return {
    loading: credentials.isPending,
    error: credentials.error?.message ?? "",
    credential,
    connected: !!credential?.connected,
    off: config.data?.enabled === false,
  };
}

const DESKTOP_AGENTS = [
  { id: "claude", name: "Claude Code", Mark: ClaudeMark },
  { id: "codex", name: "Codex", Mark: CodexMark },
];

export function AiStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const { loading, error, credential, connected, off } = useAiStatus();
  const status = loading ? "loading" : error ? "error" : connected ? "connected" : "missing";
  return (
    <div className="flex w-full max-w-lg flex-col items-center">
      <div className="flex items-center" aria-hidden="true">
        {[KeyRoundIcon, ClaudeMark, CodexMark].map((Mark, index) => (
          <span
            key={index}
            className={cn(
              "flex size-11 items-center justify-center rounded-full border border-card-border bg-background",
              index > 0 && "-ml-2",
            )}
          >
            <Mark className="size-5" />
          </span>
        ))}
      </div>
      <h1 className="mt-5 text-xl font-medium text-foreground">Set up your AI</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
        Chat in the browser runs on your own OpenRouter account and credits. Your key is stored
        encrypted on this server and used only for your turns.
      </p>

      <ul
        id="onboarding-ai-providers"
        aria-busy={loading}
        className="mt-10 w-full divide-y divide-border overflow-hidden rounded-xl border border-card-border bg-card"
      >
        <li data-provider="openrouter" data-status={status} className="flex flex-col px-5 py-3">
          <div className="flex min-h-8 items-center gap-4">
            <KeyRoundIcon className="size-5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-foreground">OpenRouter</div>
              <div id="onboarding-ai-status" className="text-sm text-muted-foreground">
                {loading
                  ? "Checking…"
                  : error
                    ? error
                    : credential
                      ? describe(credential)
                      : "Not connected"}
              </div>
            </div>
            {loading ? (
              <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
            ) : connected ? (
              <span className="flex items-center gap-1.5 text-sm text-success">
                <CircleCheckIcon className="size-4" />
                Connected
              </span>
            ) : null}
          </div>
          {status === "missing" && !off ? (
            <div className="pl-9">
              <OpenRouterConnect idPrefix="onboarding-openrouter" />
            </div>
          ) : null}
        </li>
        {DESKTOP_AGENTS.map(({ id, name, Mark }) => (
          <li
            key={id}
            data-provider={id}
            data-status="desktop-only"
            className="flex min-h-14 items-center gap-4 px-5 py-3"
          >
            <Mark className="size-5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-foreground">{name}</div>
              <div className="text-sm text-muted-foreground">
                Sign in with your subscription in the Verynize desktop app.
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge px-2 py-0.5 text-xs text-muted-foreground">
              <MonitorIcon className="size-3" />
              Desktop app only
            </span>
          </li>
        ))}
      </ul>
      {off ? (
        <p id="onboarding-ai-off" className="mt-3 text-center text-xs text-muted-foreground">
          The operator turned the model API off on this server. Chat runs in the desktop app.
        </p>
      ) : null}

      <div className="mt-8 flex flex-col items-center gap-2">
        {connected ? (
          <Button id="onboarding-ai-continue" onClick={onContinue}>
            Continue
          </Button>
        ) : (
          <Button id="onboarding-ai-skip" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}

export function ReadyStep({ onDone }: { onDone: () => void }) {
  const { credential, connected } = useAiStatus();
  return (
    <div className="flex w-full max-w-sm flex-col items-center text-center">
      <CircleCheckIcon className="size-8 text-success" />
      <h1 className="mt-5 text-xl font-medium text-foreground">You're all set</h1>
      <p id="onboarding-ready-summary" className="mt-2 text-sm text-muted-foreground">
        {connected && credential
          ? `Chat runs on your OpenRouter account (key ending ${credential.last4}). Open a shared design and start a chat.`
          : "Connect OpenRouter any time in Settings › Agents to chat in the browser."}{" "}
        Claude Code and Codex run in the desktop app.
      </p>
      <Button id="onboarding-ready-done" className="mt-8" onClick={onDone}>
        Start designing
      </Button>
    </div>
  );
}
