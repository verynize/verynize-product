// One xterm.js instance bound to one PTY session (desktop/terminal.cjs). The session starts on mount in `cwd` and is
// killed on unmount; hidden tabs stay mounted so their shells keep running.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  terminalBridge,
  writeChunks,
  type TerminalDataEvent,
  type TerminalSession,
} from "./bridge";
import type { TerminalAppearance } from "./theme";

type Props = {
  cwd: string;
  active: boolean;
  /** Changes when the user picks or adds this tab: the terminal then takes keyboard focus. */
  focusToken: number;
  appearance: TerminalAppearance;
  onSession: (session: TerminalSession) => void;
  onExit: () => void;
};

const EARLY_LIMIT = 2000; // output events kept while terminalCreate is still answering

export function TerminalView({ cwd, active, focusToken, appearance, onSession, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const initial = useRef({ appearance, onSession, onExit });

  useEffect(() => {
    initial.current = { ...initial.current, onSession, onExit };
  }, [onSession, onExit]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const bridge = terminalBridge();
    const { appearance: look } = initial.current;
    const term = new Terminal({
      theme: look.theme,
      fontFamily: look.fontFamily,
      fontSize: look.fontSize,
      lineHeight: look.lineHeight,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      macOptionClickForcesSelection: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        void bridge?.openExternal?.(uri);
      }),
    );
    term.open(host);
    termRef.current = term;

    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
        try {
          fit.fit();
        } catch {
          // xterm not laid out yet; the next resize retries.
        }
      });
    };
    fitRef.current = refit;
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(host);

    // ⌘K clears the screen and scrollback (Terminal.app); copy/paste go through the Edit menu's copy/paste events.
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        event.stopPropagation();
        term.clear();
        return false;
      }
      return true;
    });

    if (!bridge) {
      term.writeln("The terminal is available in the Verynize desktop app.");
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        term.dispose();
        termRef.current = null;
      };
    }

    let id: string | null = null;
    let disposed = false;
    let exited = false;
    const early: TerminalDataEvent[] = [];
    const earlyExits = new Set<string>();
    const finish = () => {
      if (exited) return;
      exited = true;
      initial.current.onExit();
    };
    const offData = bridge.onTerminalData((event) => {
      if (id === null) {
        if (early.length < EARLY_LIMIT) early.push(event);
      } else if (event.id === id) term.write(event.data);
    });
    const offExit = bridge.onTerminalExit((event) => {
      if (id === null) earlyExits.add(event.id);
      else if (event.id === id) finish();
    });
    const input = term.onData((data) => {
      if (!id) return;
      for (const chunk of writeChunks(data))
        bridge.terminalWrite({ id, data: chunk }).catch(() => {});
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (id) bridge.terminalResize({ id, cols, rows }).catch(() => {});
    });

    bridge.terminalCreate({ cwd, cols: term.cols, rows: term.rows }).then(
      (session) => {
        if (disposed) {
          bridge.terminalKill({ id: session.id }).catch(() => {});
          return;
        }
        id = session.id;
        for (const event of early) if (event.id === id) term.write(event.data);
        early.length = 0;
        initial.current.onSession(session);
        if (earlyExits.has(id)) return finish();
        bridge.terminalResize({ id, cols: term.cols, rows: term.rows }).catch(() => {});
      },
      (error: unknown) => {
        if (disposed) return;
        const message =
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
            : String(error);
        term.writeln(`\x1b[31m${message}\x1b[0m`);
      },
    );

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      offData();
      offExit();
      input.dispose();
      resize.dispose();
      if (id && !exited) bridge.terminalKill({ id }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [cwd]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = appearance.theme;
    term.options.fontFamily = appearance.fontFamily;
    term.options.fontSize = appearance.fontSize;
    term.options.lineHeight = appearance.lineHeight;
    fitRef.current?.();
  }, [appearance]);

  useEffect(() => {
    if (active) fitRef.current?.();
  }, [active]);

  useEffect(() => {
    if (active && focusToken > 0) termRef.current?.focus();
  }, [active, focusToken]);

  return (
    <div
      ref={hostRef}
      data-slot="terminal-view"
      className="size-full overflow-hidden px-2 pt-1.5"
    />
  );
}
