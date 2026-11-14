// Web chat gate (in place of the composer): why the model API chat cannot run a turn here yet. The three credentials
// stay separate: the Verynize account (sign in), the user's own OpenRouter account (Connect OpenRouter, or a pasted
// key; lib/ai-credentials.ts), and Claude Code / Codex sign-ins, which only the desktop app uses.
// Test contract: `#chat-web-gate[data-state]`, `#chat-web-connect-openrouter`, `#chat-web-paste-key`,
// `#chat-web-openrouter-key`, `#chat-web-save-key`, `#chat-web-key-error`. The web AI setup step
// (onboarding/ai-step.tsx) renders the same connect controls under its own id prefix.
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import type { AgentTransport } from "@/lib/agent-transport";
import {
  connectOpenRouter,
  openRouterReturn,
  openRouterReturnMessage,
  saveOpenRouterKey,
} from "@/lib/ai-credentials";
import { openSignIn } from "@/lib/cloud-account";
import { ChatActionButton } from "./controls";

const DETAIL: Partial<Record<AgentTransport["state"], string>> = {
  "signed-out":
    "The web chat runs on this server's model API with your Verynize account. Claude Code and Codex sign-ins work in the desktop app only.",
  "not-configured":
    "The operator turned the model API off on this server. Claude Code and Codex run in the desktop app.",
  "needs-credentials":
    "The web chat runs on your own OpenRouter account and its credits. Your key is stored encrypted on this server and used only for your turns. This is separate from Claude Code and Codex, which run in the desktop app.",
  "no-room":
    "The model API works on shared cloud rooms. Share this design or open one of your rooms, then chat here.",
};

/** Connect OpenRouter (OAuth in this tab) or paste a key. Element ids are `<idPrefix>-connect-openrouter`, … */
export function OpenRouterConnect({ idPrefix = "chat-web" }: { idPrefix?: string }) {
  const [pasting, setPasting] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const returned = openRouterReturn();
  const [error, setError] = useState(
    returned?.status === "error" ? openRouterReturnMessage(returned.reason) : "",
  );
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await connectOpenRouter();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      await saveOpenRouterKey(key.trim());
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1.5 flex w-full flex-col items-start gap-2">
      <div className="flex items-center gap-2">
        <ChatActionButton
          id={`${idPrefix}-connect-openrouter`}
          disabled={busy}
          onClick={() => void connect()}
        >
          Connect OpenRouter
        </ChatActionButton>
        <ChatActionButton
          id={`${idPrefix}-paste-key`}
          variant="ghost"
          aria-expanded={pasting}
          onClick={() => setPasting(!pasting)}
        >
          Paste API key
        </ChatActionButton>
      </div>
      {pasting && (
        <form className="flex w-full items-center gap-2" onSubmit={(event) => void save(event)}>
          <Input
            id={`${idPrefix}-openrouter-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="OpenRouter API key"
            placeholder="sk-or-v1-…"
            value={key}
            disabled={busy}
            onChange={(event) => setKey(event.target.value)}
          />
          <ChatActionButton
            id={`${idPrefix}-save-key`}
            type="submit"
            disabled={busy || !key.trim()}
          >
            Save key
          </ChatActionButton>
        </form>
      )}
      {error && (
        <p id={`${idPrefix}-key-error`} role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function WebChatGate({ transport }: { transport: AgentTransport }) {
  const multiple = !!transport.config?.providers;
  const detail =
    multiple && transport.state === "needs-credentials"
      ? "Connect a provider in Settings › Agents to use its models and credits."
      : DETAIL[transport.state];
  return (
    <div
      id="chat-web-gate"
      data-state={transport.state}
      role="status"
      className="mx-4 mb-4 flex shrink-0 flex-col items-start gap-1.5 rounded-2xl border border-card-border bg-card px-4 py-3"
    >
      <p className="m-0 text-base leading-5.25 font-medium text-foreground">
        {multiple && transport.state === "needs-credentials"
          ? "Connect an AI provider"
          : transport.message}
      </p>
      {detail && <p className="m-0 text-sm leading-5 text-muted-foreground">{detail}</p>}
      {transport.state === "signed-out" && (
        <ChatActionButton id="chat-web-sign-in" className="mt-1.5" onClick={openSignIn}>
          Sign in
        </ChatActionButton>
      )}
      {transport.state === "needs-credentials" && (
        <>
          <OpenRouterConnect />
          {multiple && (
            <ChatActionButton
              id="chat-web-provider-settings"
              variant="ghost"
              onClick={() => window.appSettings?.open("agents")}
            >
              Choose another provider
            </ChatActionButton>
          )}
        </>
      )}
      {transport.state === "no-room" && (
        <ChatActionButton
          id="chat-web-share"
          variant="outline"
          className="mt-1.5"
          onClick={() => document.getElementById("cloud-toggle")?.click()}
        >
          Share this design
        </ChatActionButton>
      )}
    </div>
  );
}
