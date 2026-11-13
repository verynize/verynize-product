// Expanded preview tab body (Wonder PF3-expanded-verified): a 36px browser bar (back, forward, reload, path; Publish
// and "Show on canvas" on the right), the running app full width below it in its own iframe, and the
// Navigate / Edit / Capture toolbar at the bottom. The iframe keeps the canvas preview's sandbox and session; it is
// named `verynize-preview-tab` (only while its tab is the visible one) so main-process lookups of the canvas frame
// `verynize-live-preview` never pick it up.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DropdownMenu } from "radix-ui";
import {
  ChevronLeft,
  ChevronRight,
  EllipsisIcon,
  ExternalLinkIcon,
  Minimize2,
  MousePointerSquareDashedIcon,
  RotateCw,
  ScanIcon,
  Share,
  TargetIcon,
} from "lucide-react";
import { portalContainer, useBodyClass } from "@/lib/bridge";
import { Tip } from "../tip";
import {
  TAB_FRAME_NAME,
  getTab,
  loadTab,
  localURL,
  setTabURL,
  showOnCanvas,
  usePreviewTabs,
  type PreviewTab,
} from "./store";
import "./preview-tab.css";
import { platform } from "@/lib/platform";

type LivePreview = {
  pickRegion?(
    host: HTMLElement,
    options: {
      width: number;
      height: number;
      elementAt(point: { x: number; y: number }): Promise<unknown>;
    },
  ): Promise<{ x: number; y: number; width: number; height: number } | null>;
  insertCaptured?(captured: unknown, place: (page: unknown) => { x: number; y: number }): void;
  editMode?(): void;
  openPublish?(frameId: string): void;
};
const desktop = () => platform.desktop;
const livePreview = () => (window as unknown as { livePreview?: LivePreview }).livePreview;

const SANDBOX = "allow-scripts allow-forms allow-same-origin allow-downloads";
const pathOf = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
};

export function PreviewTabView() {
  const { tabs, active } = usePreviewTabs();
  const codeMode = useBodyClass("code-mode");
  const filesView = useBodyClass("files-view");
  if (!tabs.length) return null;
  return (
    <div id="preview-tab-view" hidden={!active || codeMode || filesView} data-bd="">
      {tabs.map((tab) => (
        <PreviewTabPanel key={tab.frameId} tab={tab} visible={active === tab.frameId} />
      ))}
    </div>
  );
}

function PreviewTabPanel({ tab, visible }: { tab: PreviewTab; visible: boolean }) {
  const [path, setPath] = useState(() => pathOf(tab.url));
  const [mode, setMode] = useState<"navigate" | "capture">("navigate");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const running = tab.status === "running" && !!tab.src;
  const publish = typeof livePreview()?.openPublish === "function";

  useEffect(() => setPath(pathOf(tab.url)), [tab.url]);
  useEffect(() => {
    if (!running) setMode("navigate");
  }, [running]);
  useEffect(() => setError(""), [tab.load, visible]);

  const perform = async (action: () => unknown) => {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const navigate = (direction: "back" | "forward") =>
    void perform(() => desktop()?.previewNavigate?.({ direction, target: "tab" }));
  const onLoad = async () => {
    // Only the visible tab's iframe carries the frame name the main process looks up.
    if (!visible) return;
    try {
      const location = await desktop()?.previewLocation?.({ target: "tab" });
      if (location?.url && getTab(tab.frameId)) setTabURL(tab.frameId, location.url);
    } catch {
      /* the frame left localhost or is gone; keep the last path */
    }
  };
  const onPathKey = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      setPath(pathOf(tab.url));
      event.currentTarget.blur();
    }
    if (event.key !== "Enter" || !tab.url) return;
    try {
      loadTab(tab.frameId, localURL(new URL(event.currentTarget.value || "/", tab.url).href));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const capture = async () => {
    const host = stage.current;
    const preview = livePreview();
    if (!host || !frame.current || !preview?.pickRegion || !preview.insertCaptured) return;
    setMode("capture");
    try {
      const region = await preview.pickRegion(host, {
        width: frame.current.clientWidth,
        height: frame.current.clientHeight,
        elementAt: (point) => desktop()!.previewElementAt!({ ...point, target: "tab" }),
      });
      if (!region) return;
      const captured = await desktop()!.captureLivePreview!({
        url: tab.url,
        region,
        target: "tab",
      });
      // Captured layers land right of the preview frame on the canvas, which then shows them.
      await showOnCanvas(tab.frameId);
      const doc = window.design.getDocument();
      const node = doc.pages
        .flatMap((page) => page.nodes)
        .find((candidate) => candidate.id === tab.frameId);
      if (!node) throw Error("The preview frame is no longer on the canvas.");
      const before = new Set(
        doc.pages.flatMap((page) => page.nodes.map((candidate) => candidate.id)),
      );
      preview.insertCaptured(captured, () => ({ x: node.x + node.w + 80, y: node.y }));
      const added = window.design
        .getDocument()
        .pages.flatMap((page) => page.nodes)
        .filter((candidate) => !before.has(candidate.id) && !candidate.parentId);
      if (added.length) window.design.setSelection(added.map((candidate) => candidate.id));
    } finally {
      setMode("navigate");
    }
  };
  const edit = async () => {
    await showOnCanvas(tab.frameId);
    livePreview()?.editMode?.();
  };

  return (
    <section
      data-pt="panel"
      data-preview-tab-panel={tab.frameId}
      data-status={tab.status}
      hidden={!visible}
      aria-label={`${tab.name} preview`}
    >
      <div data-pt="bar" role="toolbar" aria-label="Preview browser">
        <Tip label="Back" side="bottom">
          <button
            type="button"
            aria-label="Back"
            disabled={!running}
            onClick={() => navigate("back")}
          >
            <ChevronLeft />
          </button>
        </Tip>
        <Tip label="Forward" side="bottom">
          <button
            type="button"
            aria-label="Forward"
            disabled={!running}
            onClick={() => navigate("forward")}
          >
            <ChevronRight />
          </button>
        </Tip>
        <Tip label="Reload" side="bottom">
          <button
            type="button"
            aria-label="Reload preview"
            disabled={!running}
            onClick={() => loadTab(tab.frameId)}
          >
            <RotateCw />
          </button>
        </Tip>
        <input
          data-pt="path"
          aria-label="Preview path"
          spellCheck={false}
          value={path}
          disabled={!running}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={onPathKey}
          onBlur={() => setPath(pathOf(tab.url))}
        />
        {publish ? (
          <button
            type="button"
            data-pt="publish"
            onClick={() =>
              void perform(() =>
                showOnCanvas(tab.frameId).then(() => livePreview()?.openPublish?.(tab.frameId)),
              )
            }
          >
            <Share />
            Publish
          </button>
        ) : null}
        <Tip label="Show on canvas" side="bottom">
          <button
            type="button"
            aria-label="Show on canvas"
            data-preview-show-canvas=""
            onClick={() => void showOnCanvas(tab.frameId)}
          >
            <Minimize2 />
          </button>
        </Tip>
      </div>
      <div data-pt="stage" ref={stage}>
        {running ? (
          <iframe
            key={tab.load}
            ref={frame}
            src={tab.src}
            name={visible ? TAB_FRAME_NAME : ""}
            title={`${tab.name} running app`}
            sandbox={SANDBOX}
            onLoad={() => void onLoad()}
          />
        ) : (
          <div data-pt="placeholder" role="status">
            <strong>
              {tab.status === "starting"
                ? "Starting your app"
                : tab.status === "error"
                  ? "Preview failed"
                  : "Preview stopped"}
            </strong>
            <p>
              {tab.status === "starting"
                ? "Waiting for the app…"
                : "Start the preview from the canvas or the chat to see your app here."}
            </p>
            <button type="button" onClick={() => void showOnCanvas(tab.frameId)}>
              Show on canvas
            </button>
          </div>
        )}
        <div data-pt="toolbar" role="toolbar" aria-label="Preview tools">
          <Tip label="Navigate inside">
            <button
              type="button"
              aria-pressed={mode === "navigate"}
              disabled={!running}
              onClick={() => setMode("navigate")}
            >
              <MousePointerSquareDashedIcon />
              Navigate
            </button>
          </Tip>
          <Tip label="Inspect element" shortcut="⌘⇧I">
            <button
              type="button"
              aria-pressed={false}
              disabled={!running}
              onClick={() => void perform(edit)}
            >
              <TargetIcon />
              Edit
            </button>
          </Tip>
          <Tip
            label={
              <span>
                Capture<span data-pt="tip-note">Add an editable design to canvas</span>
              </span>
            }
          >
            <button
              type="button"
              aria-pressed={mode === "capture"}
              disabled={!running || mode === "capture"}
              onClick={() => void perform(capture)}
            >
              <ScanIcon />
              Capture
            </button>
          </Tip>
          <span role="separator" aria-orientation="vertical" />
          <DropdownMenu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenu.Trigger asChild>
              <button type="button" data-pt="more" aria-label="More preview options">
                <EllipsisIcon />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={portalContainer()}>
              <DropdownMenu.Content
                data-pt="menu"
                side="top"
                align="end"
                sideOffset={8}
                collisionPadding={8}
              >
                <DropdownMenu.Item
                  disabled={!running}
                  onSelect={() =>
                    void perform(() => desktop()?.previewOpenBrowser?.({ target: "tab" }))
                  }
                >
                  <ExternalLinkIcon />
                  Open in browser
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => void showOnCanvas(tab.frameId)}>
                  <Minimize2 />
                  Show on canvas
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
