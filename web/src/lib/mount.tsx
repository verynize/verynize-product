import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { markIslandCommitted, registerIsland } from "@/lib/bridge";
import { queryClient } from "@/lib/query/client";
import { reportError } from "@/lib/telemetry/runtime";
import "@/styles/globals.css";

// The shell is a fixed one-viewport layout; undo any document scroll caused by focus or scrollIntoView
// (panels scroll inside their own containers).
let scrollGuard = false;
function guardDocumentScroll() {
  if (scrollGuard) return;
  scrollGuard = true;
  document.addEventListener("scroll", () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  });
}

/** Reports the island's first commit to the UI-ready signal (bridge.ts). Renders nothing. */
function Committed({ name }: { name: string }) {
  useEffect(() => markIslandCommitted(name), [name]);
  return null;
}

/**
 * The context every island tree gets: the one QueryClient and the tooltip provider. Island roots (mountIsland) and
 * the areas Start's routes render on the web (inside Start's own React tree) both use it.
 */
export function IslandProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

/**
 * Mount an island once the legacy scripts have run.
 * `target` is the element the island renders into (created if it is a string id that does not exist yet).
 * Every island shares one QueryClient (`@/lib/query/client`).
 * The island holds back `html[data-ui-ready]` / `bd:ui-ready` until its first render has committed.
 */
export function mountIsland(
  name: string,
  target: HTMLElement | (() => HTMLElement),
  node: () => ReactNode,
) {
  guardDocumentScroll();
  registerIsland(name);
  const start = () => {
    const container = typeof target === "function" ? target() : target;
    container.setAttribute("data-bd", "");
    container.dataset.island = name;
    // Errors an error boundary caught still go to crash reports (when on); uncaught ones reach them through
    // React's default window error event.
    createRoot(container, {
      onCaughtError: (error, info) => {
        console.error(error);
        reportError(error, {
          mechanism: "react.caught",
          componentStack: info.componentStack ?? undefined,
        });
      },
    }).render(
      <StrictMode>
        {/* One QueryClient for every island root: server state is shared across islands. */}
        <IslandProviders>{node()}</IslandProviders>
        <Committed name={name} />
      </StrictMode>,
    );
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

/** Create (or reuse) a container element with an id, appended to `parent` (default: body). */
export function ensureContainer(
  id: string,
  parent: Element = document.body,
  tag = "div",
): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    parent.append(el);
  }
  return el;
}
