import { SparklesIcon } from "lucide-react";
import { useAgentTransport, webAgentScope } from "@/lib/agent-transport";
import { aiProviders, type AiProvider } from "@/lib/agent-service";
import { useCloudAccount } from "@/lib/cloud-account";
import { setAiSelection, useAiSelection, useAiDefaultModel } from "@/lib/ai-preferences";
import type { AccountScope } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { hook } from "./hooks";
import { useAdopt } from "./adopt";
import { ChatChipButton } from "./controls";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuGroup,
  ChatMenuItem,
  ChatMenuLabel,
  ChatMenuSeparator,
  ChatMenuTrigger,
} from "./menu";
import { workspace, type ChatState } from "./store";

export function WebModelMenu({
  state,
  open,
  onOpenChange,
}: {
  state: ChatState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const transport = useAgentTransport();
  const scope = webAgentScope(useCloudAccount());
  const selection = useAiSelection(scope, state.conversationId || "");
  const selectedProvider = selection?.provider || transport.config?.defaultProvider || "openrouter";
  const selectedModel = selection?.model ?? state.defaults.model;
  const providers = transport.config
    ? aiProviders(transport.config).filter((provider) => provider.connected !== "missing")
    : [];
  const provider = providers.find((entry) => entry.id === selectedProvider);
  const name = selectedModel
    ? provider?.models.find((model) => model.id === selectedModel)?.label || selectedModel
    : provider?.label || selectedProvider;
  // Keep the legacy input owned, hidden and available to the desktop-panel contract.
  const modelSlot = useAdopt("agent-model");
  return (
    <ChatMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <div className={cn(hook.agentConfig, "contents")}>
        <ChatMenuTrigger asChild>
          <ChatChipButton asChild>
            <summary tabIndex={0} role="button" aria-label="Model and effort" className="list-none">
              <SparklesIcon className="size-3.5 text-muted-foreground" />
              <span id="bd-agent-model-label" className="max-w-40 truncate">
                {name}
              </span>
            </summary>
          </ChatChipButton>
        </ChatMenuTrigger>
      </div>
      <div ref={modelSlot} className="hidden" />
      <ChatMenuContent align="start" side="top" className="w-72">
        {providers.map((entry, index) => (
          <ProviderModels
            key={entry.id}
            provider={entry}
            scope={scope}
            chatId={state.conversationId}
            editing={state.defaults.access !== "ask"}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            first={index === 0}
            legacy={!transport.config?.providers}
          />
        ))}
      </ChatMenuContent>
    </ChatMenu>
  );
}

function ProviderModels({
  provider,
  scope,
  chatId,
  editing,
  selectedProvider,
  selectedModel,
  first,
  legacy,
}: {
  provider: AiProvider;
  scope: AccountScope | null;
  chatId: string | null;
  editing: boolean;
  selectedProvider: string;
  selectedModel: string;
  first: boolean;
  legacy: boolean;
}) {
  const preferred = useAiDefaultModel(scope, provider.id);
  const chatOnly = provider.capabilities?.tools === false;
  const available = !!scope && !(editing && chatOnly);
  const models = provider.models.filter((model) => !editing || model.tools);
  const defaultModel = provider.models.find(
    (model) => model.id === (preferred || provider.defaultModel),
  );
  const defaultAllowed = !editing || !!defaultModel?.tools;
  const choose = (model: string) => {
    if (!scope) return;
    let targetChat = chatId;
    if (!targetChat) {
      const ws = workspace();
      const prompt = document.getElementById("project-prompt");
      const draft = prompt instanceof HTMLTextAreaElement ? prompt.value : "";
      ws?.createChat?.({});
      ws?.setDraft?.(draft);
      targetChat = ws?.getState().conversationId ?? null;
    }
    if (targetChat) setAiSelection(scope, targetChat, { provider: provider.id, model });
  };
  return (
    <ChatMenuGroup>
      {!first && <ChatMenuSeparator />}
      <ChatMenuLabel>{legacy ? "Model API" : provider.label}</ChatMenuLabel>
      {chatOnly && <ChatMenuLabel>Chat-only · use Ask for this provider</ChatMenuLabel>}
      <ChatMenuItem
        disabled={!available || !defaultAllowed}
        checked={selectedProvider === provider.id && !selectedModel}
        onSelect={() => choose("")}
      >
        <SparklesIcon className="size-3.5 text-muted-foreground" />
        {provider.label} default{chatOnly && " · Chat-only"}
      </ChatMenuItem>
      {models.map((model) => (
        <ChatMenuItem
          key={model.id}
          disabled={!available}
          checked={selectedProvider === provider.id && selectedModel === model.id}
          onSelect={() => choose(model.id)}
        >
          <SparklesIcon className="size-3.5 text-muted-foreground" />
          <span className="truncate">{model.label}</span>
        </ChatMenuItem>
      ))}
    </ChatMenuGroup>
  );
}
