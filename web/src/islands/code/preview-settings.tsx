/* oxlint-disable shadcn/no-restyle -- Wonder's repository settings modal (X1): a full-bleed two-column dialog (no
   padding, 16px radius) at the settings density (13px text, 29px fields, 28px footer buttons). */
// Preview settings (X1, PS2-edit): "<repo> / Repository settings" with the Preview section. It edits the saved run
// configuration of a root (desktop/dev-server.cjs): start commands (Name / Start command / Opens at), the setup
// command (steps chained with &&, run before the first start and again after it changes) and the stop command
// (run when the Preview stops). Opened with window.previewSettings.open(root?); the dialog itself is mounted once by
// <PreviewSettingsHost> (chat island).
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { FolderIcon, GlobeIcon, LoaderCircleIcon, PlusIcon, Trash2Icon, PanelTopIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ChatState } from "../chat/store";
import { desktop, errorMessage, setStatus, workspace, type PreviewCommand } from "./api";
import { repositoryByKey } from "./controller";
import { formatCommand, formatSteps, parsePreviewCommand, parsePreviewSteps } from "./preview-command";
import { announce, requestSetup } from "./preview-state";

declare global {
  interface Window {
    previewSettings?: { open(root?: string): void; close(): void };
  }
}

let openRoot: string | null = null;
const listeners = new Set<() => void>();
const setOpenRoot = (root: string | null) => {
  openRoot = root;
  listeners.forEach((fn) => fn());
};
window.previewSettings = {
  open(root) {
    const target = root || workspace()?.getState().activeRoot || null;
    if (!target) {
      setStatus("Open a repository to change its Preview settings.");
      return;
    }
    setOpenRoot(target);
  },
  close: () => setOpenRoot(null),
};

export function PreviewSettingsHost({ state }: { state: ChatState }) {
  const root = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => openRoot,
  );
  return root ? <PreviewSettingsDialog key={root} root={root} state={state} onClose={() => setOpenRoot(null)} /> : null;
}

/** `key`: a stable React key, so removing a row does not reuse another row's inputs. Never saved. */
type Row = { key: number; name: string; command: string; url: string };
let rowKeys = 0;
const emptyRow = (index: number): Row => ({ key: ++rowKeys, name: index ? "" : "App", command: "", url: "" });

/** Opens at: blank = the address the command prints; a port, host:port or a localhost URL. */
function opensAt(value: string): string | undefined {
  const text = value.trim();
  if (!text || /^default$/i.test(text)) return undefined;
  const candidate = /^\d+$/.test(text) ? `http://localhost:${text}/` : /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`“${text}” is not an address. Use a port such as 5173 or http://localhost:5173/.`);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol))
    throw new Error("Opens at must be a localhost address, such as http://localhost:5173/.");
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) throw new Error("Port must be between 1 and 65535.");
  return url.href;
}
const shownURL = (url?: string) => (url ? url.replace(/^http:\/\//, "").replace(/\/$/, "") : "");

function CommandField({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  id?: string;
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("m-0 flex h-7.25 min-w-0 items-center gap-2 rounded-md border border-card-border bg-background px-2.5 focus-within:ring-1 focus-within:ring-ring", className)}>
      <span aria-hidden className="font-mono text-xs text-muted-foreground">
        $
      </span>
      <input
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground-2 outline-none placeholder:text-subtle-foreground disabled:opacity-50"
      />
    </label>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="px-4">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-card-border bg-card p-4">{children}</div>
    </section>
  );
}

function PreviewSettingsDialog({ root, state, onClose }: { root: string; state: ChatState; onClose(): void }) {
  const [rows, setRows] = useState<Row[]>([emptyRow(0)]);
  const [setup, setSetup] = useState("");
  const [stop, setStop] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const repo = repositoryByKey(state.projectKey);
  const repoName = repo?.name || state.projectName || root.split("/").pop() || "Repository";

  useEffect(() => {
    let live = true;
    void desktop()
      ?.devServer?.status({ root })
      .then((status) => {
        if (!live) return;
        const config = status.config;
        const commands: PreviewCommand[] = config?.commands?.length
          ? config.commands
          : config
            ? [{ name: "App", command: config.command, url: config.url }]
            : [];
        setRows(
          commands.length
            ? commands.map((c) => ({ key: ++rowKeys, name: c.name, command: formatCommand(c.command), url: shownURL(c.url) }))
            : [{ ...emptyRow(0), command: formatCommand(status.detected?.command) }],
        );
        setSetup(formatSteps(config?.setupSteps || (config?.setup ? [config.setup] : null)));
        setStop(formatSteps(config?.stopSteps));
      })
      .catch((error) => live && setMessage(errorMessage(error)))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [root]);

  const edit = (index: number, patch: Partial<Row>) => {
    setMessage("");
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const save = async () => {
    const api = desktop()?.devServer;
    if (!api) return;
    setMessage("");
    try {
      const filled = rows.filter((row) => row.command.trim() || row.url.trim());
      if (!filled.length) throw new Error("Enter a start command.");
      const commands = filled.map((row, index) => {
        const command = parsePreviewCommand(row.command);
        if (!command.length) throw new Error(`Enter a start command for ${row.name.trim() || `row ${index + 1}`}.`);
        return { name: row.name.trim() || (index ? `Command ${index + 1}` : "App"), command, url: opensAt(row.url) };
      });
      const setupSteps = parsePreviewSteps(setup);
      const stopSteps = parsePreviewSteps(stop);
      setBusy(true);
      await api.configure({
        root,
        commands,
        setup: setupSteps.length ? setupSteps : undefined,
        stop: stopSteps.length ? stopSteps : undefined,
      });
      announce(root);
      setStatus("Preview settings saved");
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const detect = () => {
    onClose();
    requestSetup(state);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        id="preview-settings"
        // Keyboard focus starts on the dialog itself, not on "Detect with agent" (no ring at open, as in Wonder X1).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        // Var syntax so tailwind-merge replaces DialogContent's max-w-lg (it does not know the theme's size).
        className="flex h-(--spacing-preview-settings-height) max-h-full max-w-(--spacing-preview-settings) gap-0 overflow-hidden rounded-preview-settings border-card-border p-0 sm:max-w-(--spacing-preview-settings)"
      >
        <nav aria-label="Repository settings" className="flex w-(--spacing-preview-settings-nav) shrink-0 flex-col gap-4 border-r border-card-border bg-code-sidebar px-2 py-6">
          <div className="flex items-start gap-2.5 px-2">
            <FolderIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p id="preview-settings-repository" className="truncate text-sm font-medium text-foreground">
                {repoName}
              </p>
              <p className="text-xs text-muted-foreground">Repository settings</p>
            </div>
          </div>
          <div className="flex flex-col">
            <span aria-current="page" className="flex h-7.5 items-center gap-2.5 rounded-lg bg-input px-2 text-sm text-foreground">
              <PanelTopIcon className="size-4 text-muted-foreground" />
              Preview
            </span>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-8">
            <div className="flex flex-col gap-10">
              <div className="px-4">
                <DialogTitle asChild><h2 className="text-xl font-medium text-foreground">Preview</h2></DialogTitle>
                <DialogDescription asChild>
                  <p className="mt-3 text-sm text-muted-foreground">How the Preview starts, opens and stops your app in a worktree.</p>
                </DialogDescription>
              </div>
              <Section
                title="Preview commands"
                description="Each command starts a part of your app. Leave “Opens at” on Default to open the address the command prints."
              >
                <div className="flex flex-col gap-2" role="table" aria-label="Preview commands">
                  <div role="row" className="flex items-center gap-2 text-sm text-foreground-2">
                    <span role="columnheader" className="w-32 shrink-0">Name</span>
                    <span role="columnheader" className="min-w-0 flex-1">Start command</span>
                    <span role="columnheader" className="w-47 shrink-0">Opens at</span>
                    {rows.length > 1 && <span className="w-7.25 shrink-0" />}
                  </div>
                  {rows.map((row, index) => (
                    <div role="row" key={row.key} data-preview-command={index} className="flex items-center gap-2">
                      <input
                        aria-label={index ? `Name ${index + 1}` : "Name"}
                        value={row.name}
                        onChange={(e) => edit(index, { name: e.target.value })}
                        placeholder="App"
                        disabled={!loaded || busy}
                        className="h-7.25 w-32 shrink-0 rounded-md border border-card-border bg-background px-2.5 text-sm text-foreground-2 outline-none placeholder:text-subtle-foreground focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <CommandField
                        id={index ? `preview-run-command-${index + 1}` : "preview-run-command"}
                        label={index ? `Start command ${index + 1}` : "Start command"}
                        value={row.command}
                        onChange={(command) => edit(index, { command })}
                        placeholder="npm run dev"
                        disabled={!loaded || busy}
                        className="flex-1"
                      />
                      <label className="m-0 flex h-7.25 w-47 shrink-0 items-center gap-2 rounded-md border border-card-border bg-background px-2.5 focus-within:ring-1 focus-within:ring-ring">
                        <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <input
                          id={index ? `preview-opens-at-${index + 1}` : "preview-opens-at"}
                          aria-label={index ? `Opens at ${index + 1}` : "Opens at"}
                          value={row.url}
                          onChange={(e) => edit(index, { url: e.target.value })}
                          placeholder="Default"
                          disabled={!loaded || busy}
                          spellCheck={false}
                          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground-2 outline-none placeholder:text-subtle-foreground"
                        />
                      </label>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove ${row.name || `command ${index + 1}`}`}
                          disabled={busy}
                          onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                          className="flex size-7.25 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  id="preview-add-command"
                  disabled={!loaded || busy || rows.length >= 8}
                  onClick={() => setRows((list) => [...list, emptyRow(list.length)])}
                  className="h-7 self-start px-2 text-sm text-foreground-2"
                >
                  <PlusIcon className="size-3.5" />
                  Add start command
                </Button>
              </Section>
              <Section title="Setup and stop">
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-sm text-foreground-2">Setup command</p>
                    <p className="text-sm text-muted-foreground">
                      Runs in each worktree before the Preview first starts your app, and again after you change it or if it didn’t finish. Chain steps
                      with &&.
                    </p>
                  </div>
                  <CommandField id="preview-setup-command" label="Setup command" value={setup} onChange={(value) => { setMessage(""); setSetup(value); }} placeholder="npm install" disabled={!loaded || busy} />
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <div>
                    <p className="text-sm text-foreground-2">Stop command</p>
                    <p className="text-sm text-muted-foreground">Runs when you stop the Preview, to end what the start command left running, like containers.</p>
                  </div>
                  <CommandField id="preview-stop-command" label="Stop command" value={stop} onChange={(value) => { setMessage(""); setStop(value); }} placeholder="docker compose down" disabled={!loaded || busy} />
                </div>
              </Section>
            </div>
          </div>
          <div className="flex h-15 shrink-0 items-center gap-2 border-t border-card-border px-6">
            <Button type="button" variant="ghost" id="preview-detect" disabled={busy || state.busy || !state.activeRoot || state.activeRoot !== root} onClick={detect} className="h-7 px-2 text-sm text-foreground-2">
              {state.busy && <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />}
              Detect with agent
            </Button>
            <p role="status" className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={message}>
              {message}
            </p>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="h-7 px-3 text-sm">
              Cancel
            </Button>
            <Button type="button" id="preview-settings-save" disabled={busy || !loaded} onClick={() => void save()} className="h-7 px-3 text-sm">
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
