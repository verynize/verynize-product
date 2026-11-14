// Browser-local preferences, separate from server state: no endpoint writes model defaults.
// Keep the legacy runtime id OpenRouter; the web transport resolves the selected provider per turn.
import { useSyncExternalStore } from "react";
import type { AiSelection } from "./agent-service";
import type { AccountScope } from "./query/keys";

const event = "verynize:ai-preferences";
const key = (scope: AccountScope, kind: string, id: string) =>
  JSON.stringify(["verynize.ai", scope.server, scope.accountId, kind, id]);
const read = (scope: AccountScope | null, kind: string, id: string) => {
  try {
    return scope ? localStorage.getItem(key(scope, kind, id)) || "" : "";
  } catch {
    return "";
  }
};
const write = (scope: AccountScope, kind: string, id: string, value: string) => {
  localStorage.setItem(key(scope, kind, id), value);
  window.dispatchEvent(new Event(event));
};
const subscribe = (notify: () => void) => {
  window.addEventListener(event, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(event, notify);
    window.removeEventListener("storage", notify);
  };
};
function parseSelection(raw: string): AiSelection | null {
  try {
    const value = JSON.parse(raw);
    return typeof value?.provider === "string" && typeof value?.model === "string" ? value : null;
  } catch {
    return null;
  }
}
export const aiSelection = (scope: AccountScope | null, chatId: string) =>
  parseSelection(read(scope, "chat", chatId));
export const aiDefaultModel = (scope: AccountScope | null, provider: string) =>
  read(scope, "default", provider);
export const setAiSelection = (scope: AccountScope, chatId: string, selection: AiSelection) =>
  write(scope, "chat", chatId, JSON.stringify(selection));
export const setAiDefaultModel = (scope: AccountScope, provider: string, model: string) =>
  write(scope, "default", provider, model);
export function useAiSelection(scope: AccountScope | null, chatId: string) {
  return parseSelection(
    useSyncExternalStore(
      subscribe,
      () => read(scope, "chat", chatId),
      () => "",
    ),
  );
}
export function useAiDefaultModel(scope: AccountScope | null, provider: string) {
  return useSyncExternalStore(
    subscribe,
    () => aiDefaultModel(scope, provider),
    () => "",
  );
}
