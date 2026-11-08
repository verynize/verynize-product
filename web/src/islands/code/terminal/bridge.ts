// Typed access to the integrated-terminal part of `window.desktop` (desktop/preload.cjs, desktop/terminal.cjs).
import { can, platform } from "@/lib/platform";

export type TerminalSession = { id: string; shell: string; cwd: string };
export type TerminalDataEvent = { id: string; data: string };
export type TerminalExitEvent = {
  id: string;
  exitCode: number | null;
  signal: number | string | null;
};

export type TerminalBridge = {
  terminalCreate(options: { cwd: string; cols?: number; rows?: number }): Promise<TerminalSession>;
  terminalWrite(options: { id: string; data: string }): Promise<boolean>;
  terminalResize(options: { id: string; cols: number; rows: number }): Promise<boolean>;
  terminalKill(options: { id: string }): Promise<boolean>;
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void;
  openExternal?(url: string): Promise<unknown>;
};

/** The desktop terminal API, or null outside the Electron app (or in a build without terminal support). */
export function terminalBridge(): TerminalBridge | null {
  return can("terminal") ? platform.desktop : null;
}

/** Largest single terminalWrite the main process accepts is 64 KB; pastes are split below that. */
const WRITE_CHUNK = 32 * 1024;
export function writeChunks(data: string): string[] {
  if (data.length <= WRITE_CHUNK) return [data];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < data.length) {
    let end = Math.min(offset + WRITE_CHUNK, data.length);
    const code = data.charCodeAt(end - 1);
    if (end < data.length && code >= 0xd800 && code <= 0xdbff) end -= 1; // keep surrogate pairs together
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  return chunks;
}
