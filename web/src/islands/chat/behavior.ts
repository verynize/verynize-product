// Agent behaviour settings the chat reads (Settings › Agents › Chat). The settings island publishes them as
// `window.agentBehavior` and announces changes with the `verynize:agent-behavior` event.
import { useSyncExternalStore } from "react";

export type ChatBehavior = { followUp: "queue" | "steer"; expandWork: boolean };
const FALLBACK: ChatBehavior = { followUp: "queue", expandWork: false };

type Published = { get?(): Partial<ChatBehavior> | undefined };
let cached: ChatBehavior = FALLBACK;
function read(): ChatBehavior {
  const value = (window as unknown as { agentBehavior?: Published }).agentBehavior?.get?.();
  const followUp = value?.followUp === "steer" ? "steer" : "queue";
  const expandWork = value?.expandWork === true;
  if (cached.followUp !== followUp || cached.expandWork !== expandWork)
    cached = { followUp, expandWork };
  return cached;
}
function subscribe(fn: () => void) {
  window.addEventListener("verynize:agent-behavior", fn);
  return () => window.removeEventListener("verynize:agent-behavior", fn);
}

export function useChatBehavior(): ChatBehavior {
  return useSyncExternalStore(subscribe, read);
}
