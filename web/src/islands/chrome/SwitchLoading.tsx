import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { LogoIcon } from "@/components/icons";
import "./switch-loading.css";

type SwitchState = {
  token: number;
  reason?: string;
  kind: "file" | "page";
  phase: "begin" | "ready" | "end" | "fail" | "cancel";
};

/** A file opened from Files that could not load: Files is shown again (web/wonder-shell.js) and says why. */
function announceOpenFailure(event: Event) {
  const { name, message } =
    (event as CustomEvent<{ name?: string; message?: string }>).detail ?? {};
  toast.error(name ? `Couldn’t open “${name}”` : "Couldn’t open this file", {
    id: "file-open-failed",
    description: message || "Something went wrong while loading it. Try again.",
  });
}

/** Presentation only: the coordinator owns data, ordering and the live outgoing canvas. */
export function SwitchLoading() {
  const cover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.addEventListener("file-open-failed", announceOpenFailure);
    return () => window.removeEventListener("file-open-failed", announceOpenFailure);
  }, []);
  useEffect(() => {
    const workspace = document.getElementById("workspace");
    if (!workspace) return;
    const show = (kind: SwitchState["kind"]) => {
      // The file cover starts below the title bar, wherever the shell puts <main>.
      const top = document.querySelector("main")?.getBoundingClientRect().top ?? 0;
      cover.current?.style.setProperty("top", `${top}px`);
      workspace.dataset.switchLoading = kind;
      document.body.dataset.switchLoading = kind;
    };
    const hide = () => {
      delete workspace.dataset.switchLoading;
      delete workspace.dataset.switchLeaving;
      delete document.body.dataset.switchLoading;
      delete document.body.dataset.switchLeaving;
    };
    let current: number | null = null;
    let delayTimer: ReturnType<typeof setTimeout>;
    let safetyTimer: ReturnType<typeof setTimeout>;
    let fadeTimer: ReturnType<typeof setTimeout>;
    const inert = new Map<HTMLElement, boolean>();
    const restore = () => {
      for (const [element, previous] of inert) element.inert = previous;
      inert.clear();
    };
    const clear = (immediate = false) => {
      current = null;
      clearTimeout(delayTimer);
      clearTimeout(safetyTimer);
      clearTimeout(fadeTimer);
      delete workspace.dataset.switchPending;
      restore();
      if (immediate || !workspace.dataset.switchLoading) hide();
      else {
        workspace.dataset.switchLeaving = "true";
        document.body.dataset.switchLeaving = "true";
        fadeTimer = setTimeout(
          hide,
          matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 100,
        );
      }
    };
    const blockChildren = () => {
      if (current === null) return;
      for (const child of workspace.children) {
        if (
          !(child instanceof HTMLElement) ||
          ["bd-switch-loading-root", "page-loading"].includes(child.id)
        )
          continue;
        if (!inert.has(child)) inert.set(child, child.inert);
        child.inert = true;
      }
    };
    const update = (state: SwitchState | null) => {
      if (!state) return;
      if (state.phase !== "begin") {
        if (state.token === current) clear();
        return;
      }
      clear(true);
      current = state.token;
      workspace.dataset.switchPending = state.kind;
      blockChildren();
      let delay = 120;
      try {
        const saved = localStorage.getItem("verynize.switchLoading.delay");
        if (saved !== null && Number.isFinite(Number(saved)))
          delay = Math.max(0, Math.min(30000, Number(saved)));
      } catch {
        /* Storage can be unavailable in restricted contexts. */
      }
      if (state.kind === "file" && state.reason === "home") show(state.kind);
      else delayTimer = setTimeout(() => show(state.kind), delay);
      safetyTimer = setTimeout(() => clear(), 30000);
    };
    const onChange = (event: Event) => update((event as CustomEvent<SwitchState>).detail);
    // Canvas shortcuts are document-level handlers, so inert alone is insufficient.
    const blockKey = (event: KeyboardEvent) => {
      if (current === null || event.key === "Tab") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        !workspace.contains(target) &&
        (target.closest("input, textarea, select, [contenteditable=true]") ||
          (["Enter", " ", "ArrowLeft", "ArrowRight"].includes(event.key) &&
            target.closest("button, [role=tab]")))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockPointer = (event: Event) => {
      if (current === null || !(event.target instanceof Node) || !workspace.contains(event.target))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const navigation = new MutationObserver(() => {
      if (
        (document.body.classList.contains("files-view") &&
          !location.pathname.startsWith("/editor/")) ||
        document.body.classList.contains("code-mode")
      )
        clear(true);
    });
    navigation.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    const children = new MutationObserver(blockChildren);
    children.observe(workspace, { childList: true });
    window.addEventListener("switch-loading-change", onChange);
    window.addEventListener("keydown", blockKey, true);
    window.addEventListener("keyup", blockKey, true);
    const pointerEvents = [
      "pointerdown",
      "pointermove",
      "pointerup",
      "click",
      "dblclick",
      "wheel",
      "contextmenu",
    ];
    for (const name of pointerEvents)
      window.addEventListener(name, blockPointer, { capture: true, passive: false });
    const coordinator = (
      window as Window & { switchCoordinator?: { getState(): SwitchState | null } }
    ).switchCoordinator;
    update(coordinator?.getState() ?? null);
    return () => {
      clear(true);
      navigation.disconnect();
      children.disconnect();
      window.removeEventListener("switch-loading-change", onChange);
      window.removeEventListener("keydown", blockKey, true);
      window.removeEventListener("keyup", blockKey, true);
      for (const name of pointerEvents) window.removeEventListener(name, blockPointer, true);
    };
  }, []);
  return (
    <div ref={cover} id="switch-loading-logo" role="status" aria-label="Loading file">
      <LogoIcon />
    </div>
  );
}
