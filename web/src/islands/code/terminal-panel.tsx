// Integrated terminal panel for code mode: a tab strip of PTY shells (desktop/terminal.cjs) rendered with xterm.js.
// Mounted by the code-mode layout; `cwd` is the open repository (or worktree) root, null when none is open.
// New tabs start in the current `cwd`; existing tabs keep their shell and folder when it changes.
import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { PlusIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { terminalBridge, type TerminalSession } from "./terminal/bridge";
import { readTerminalAppearance, sameAppearance, type TerminalAppearance } from "./terminal/theme";
import { TerminalView } from "./terminal/terminal-view";
import "@xterm/xterm/css/xterm.css";
import "./terminal/terminal.css";

/** Matches MAX_PER_WINDOW in desktop/terminal.cjs. */
const MAX_TABS = 8;

type Tab = { key: number; cwd: string; label: string | null };

/** Terminal colors and font from the CSS tokens, re-read when the UI theme switches. */
function useTerminalAppearance(root: RefObject<HTMLElement | null>): TerminalAppearance | null {
  const [appearance, setAppearance] = useState<TerminalAppearance | null>(null);
  useEffect(() => {
    const read = () => {
      const element = root.current;
      if (!element) return;
      const next = readTerminalAppearance(element);
      setAppearance((current) => (current && sameAppearance(current, next) ? current : next));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-ui-theme", "class", "style"],
    });
    return () => observer.disconnect();
  }, [root]);
  return appearance;
}

export function TerminalPanel({ cwd }: { cwd: string | null }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const appearance = useTerminalAppearance(rootRef);
  const [tabs, setTabsState] = useState<Tab[]>([]);
  const tabsRef = useRef<Tab[]>([]);
  const setTabs = useCallback((next: Tab[]) => {
    tabsRef.current = next;
    setTabsState(next);
  }, []);
  const [active, setActive] = useState<number | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const nextKey = useRef(1);
  const autoStarted = useRef<string | null>(null);
  const available = terminalBridge() !== null;

  const openTab = useCallback(
    (folder: string, focus: boolean) => {
      if (tabsRef.current.length >= MAX_TABS) return;
      const key = nextKey.current++;
      setTabs([...tabsRef.current, { key, cwd: folder, label: null }]);
      setActive(key);
      if (focus) setFocusToken((token) => token + 1);
    },
    [setTabs],
  );

  const closeTab = useCallback(
    (key: number) => {
      const current = tabsRef.current;
      const index = current.findIndex((tab) => tab.key === key);
      if (index < 0) return;
      const rest = current.filter((tab) => tab.key !== key);
      setTabs(rest);
      setActive((selected) =>
        selected === key ? (rest[Math.min(index, rest.length - 1)]?.key ?? null) : selected,
      );
    },
    [setTabs],
  );

  const labelTab = useCallback(
    (key: number, session: TerminalSession) => {
      setTabs(
        tabsRef.current.map((tab) => (tab.key === key ? { ...tab, label: session.shell } : tab)),
      );
    },
    [setTabs],
  );

  // The first terminal opens by itself when a repository becomes available and no terminal is open.
  useEffect(() => {
    if (!cwd || !available || autoStarted.current === cwd) return;
    autoStarted.current = cwd;
    if (tabs.length === 0) openTab(cwd, false);
  }, [cwd, available, tabs.length, openTab]);

  const showTerminals = cwd !== null && available;

  return (
    <div
      ref={rootRef}
      data-slot="terminal-panel"
      className="flex size-full min-h-0 flex-col bg-terminal text-foreground-2"
    >
      <div
        role="tablist"
        aria-label="Terminals"
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-1.5"
      >
        {tabs.map((tab) => {
          const label = tab.label ?? "Terminal";
          const selected = tab.key === active;
          return (
            <div
              key={tab.key}
              data-active={selected}
              className="group relative flex h-6 shrink-0 items-center rounded-md text-muted-foreground hover:bg-muted data-[active=true]:bg-input data-[active=true]:text-foreground"
            >
              <button
                type="button"
                role="tab"
                id={`terminal-tab-${tab.key}`}
                aria-selected={selected}
                aria-controls={`terminal-panel-${tab.key}`}
                title={tab.cwd}
                onClick={() => {
                  setActive(tab.key);
                  setFocusToken((token) => token + 1);
                }}
                className="flex h-6 items-center rounded-md pr-2 pl-6 text-sm"
              >
                {label}
              </button>
              <SquareTerminalIcon
                aria-hidden
                className="pointer-events-none absolute left-1.5 size-3.5 group-hover:invisible"
              />
              <button
                type="button"
                aria-label={`Close ${label}`}
                onClick={() => closeTab(tab.key)}
                className="absolute left-1 hidden size-4.5 items-center justify-center rounded-sm text-muted-foreground group-hover:flex hover:bg-accent hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New terminal"
          disabled={!showTerminals || tabs.length >= MAX_TABS}
          onClick={() => cwd && openTab(cwd, true)}
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {showTerminals ? null : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
            {available
              ? "Open a repository to use the terminal"
              : "The terminal is available in the Verynize desktop app"}
          </div>
        )}
        {showTerminals && tabs.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            <Button variant="ghost" size="sm" onClick={() => openTab(cwd, true)}>
              <PlusIcon className="size-3.5" />
              New terminal
            </Button>
          </div>
        ) : null}
        {appearance
          ? tabs.map((tab) => (
              <div
                key={tab.key}
                role="tabpanel"
                id={`terminal-panel-${tab.key}`}
                aria-labelledby={`terminal-tab-${tab.key}`}
                hidden={!showTerminals || tab.key !== active}
                className="absolute inset-0"
              >
                <TerminalView
                  cwd={tab.cwd}
                  active={showTerminals && tab.key === active}
                  focusToken={focusToken}
                  appearance={appearance}
                  onSession={(session) => labelTab(tab.key, session)}
                  onExit={() => closeTab(tab.key)}
                />
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
