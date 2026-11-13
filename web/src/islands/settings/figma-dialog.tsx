// The Import from Figma dialog (`#figma-dialog`), a shadcn Dialog rendered by this island in place of the markup and handlers of
// web/figma-panel.js, which keeps the parts that are no dialog: the `#figma-import` command (it dispatches
// `bd:open-figma`), .fig/.pen drops on the canvas and `window.figmaPaste`.
// - File: "Open .fig file…" imports a file as a new document.
// - Link: REST import with a transient personal access token (never saved) or the connected Figma account.
// - Account: OAuth client ID (optional secret, loopback redirect port), Connect / Disconnect.
// Ids are the legacy ones (tests use them); #figma-dialog is the dialog content, present only while open.
import { useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWindowEvent, type DesignDocument } from "@/lib/bridge";
import { can, platform } from "@/lib/platform";

type Imported = { document: DesignDocument; warnings?: string[] };
type Account = {
  clientId: string;
  port: number;
  hasClientSecret: boolean;
  redirectUri: string;
  connected: boolean;
  pending?: boolean;
  userId?: string;
};
type FigmaDesktop = {
  importFigma(options: { url: string; token?: string; useAccount?: boolean }): Promise<Imported>;
  figmaFileOpen(): Promise<Imported | null>;
  figmaOAuth: {
    status(): Promise<Account>;
    configure(options: {
      clientId: string;
      port?: number;
      clientSecret?: string;
    }): Promise<unknown>;
    connect(): Promise<unknown>;
    cancel(): Promise<unknown> | void;
    disconnect(): Promise<unknown>;
  };
};

const figma = (): FigmaDesktop | null =>
  can("figma") ? (platform.desktop as unknown as FigmaDesktop) : null;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Opens an imported document as a new library file (or, without the library, replaces the current one). */
async function openDocument(document: DesignDocument) {
  const library = window.fileLibrary as
    | { createFromDocument?(document: DesignDocument): Promise<unknown> }
    | undefined;
  if (library?.createFromDocument) {
    await library.createFromDocument(document);
    return true;
  }
  if (
    !window.confirm(
      "Replace the current design with the Figma import? Save current work first if needed.",
    )
  )
    return false;
  window.design.setDocument(document);
  return true;
}

const report = (title: string, warnings?: string[]) =>
  `${title}\n${warnings?.length ? warnings.join("\n") : "Supported properties imported without warnings."}`;

function accountStatus(account: Account) {
  if (account.pending) return "Waiting for Figma in your browser…";
  if (account.connected) return `Connected${account.userId ? ` (user ${account.userId})` : ""}.`;
  return account.clientId ? "Not connected." : "Add a client ID to connect.";
}

export function FigmaDialog() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountText, setAccountText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [useAccount, setUseAccount] = useState(true);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [port, setPort] = useState("");

  const refreshAccount = async () => {
    const desktop = figma();
    if (!desktop) {
      setAccountText("Open the desktop app to connect a Figma account.");
      return;
    }
    try {
      const next = await desktop.figmaOAuth.status();
      setAccount(next);
      setClientId(next.clientId);
      setPort(String(next.port));
      setAccountText(accountStatus(next));
    } catch (error) {
      setAccountText(message(error));
    }
  };

  useWindowEvent("bd:open-figma", () => {
    setOpen(true);
    void refreshAccount();
  });

  const close = () => {
    setToken("");
    setSecret("");
    void figma()?.figmaOAuth.cancel();
    setOpen(false);
  };

  const saveAccount = async (desktop: FigmaDesktop) => {
    await desktop.figmaOAuth.configure({
      clientId: clientId.trim(),
      port: Number(port) || undefined,
      ...(secret ? { clientSecret: secret } : {}),
    });
    setSecret("");
  };
  const accountAction =
    (id: string, task: (desktop: FigmaDesktop) => Promise<void>) => async () => {
      const desktop = figma();
      if (!desktop) return;
      setBusy(id);
      try {
        await task(desktop);
      } catch (error) {
        setAccountText(message(error));
      } finally {
        setBusy(null);
      }
    };

  const importLink = async () => {
    const desktop = figma();
    if (!desktop) {
      setStatus("Open the desktop app to import from Figma.");
      return;
    }
    setBusy("figma-run");
    setStatus("Importing…");
    try {
      const viaAccount = !!account?.connected && useAccount;
      const result = await desktop.importFigma(
        viaAccount ? { url, useAccount: true } : { url, token },
      );
      setStatus((await openDocument(result.document)) ? report("Imported.", result.warnings) : "");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setToken("");
      setBusy(null);
    }
  };

  const importFile = async () => {
    const desktop = figma();
    if (!desktop) {
      setStatus("Open the desktop app to import .fig files.");
      return;
    }
    setBusy("figma-file");
    try {
      const result = await desktop.figmaFileOpen();
      if (result && (await openDocument(result.document)))
        setStatus(report(`Imported ${result.document.name}.`, result.warnings));
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(null);
    }
  };

  const connected = !!account?.connected;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        id="figma-dialog"
        // Opened from menus: the menu returning focus to its trigger must not dismiss it (a click outside or
        // Escape still does).
        onFocusOutside={(event) => event.preventDefault()}
        className="max-h-(--spacing-dialog-max) overflow-y-auto"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.document.getElementById("figma-url")?.focus();
        }}
        showCloseButton={false}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle id="figma-title">Import from Figma</DialogTitle>
          </div>
          <Button
            id="figma-close"
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>
        <DialogDescription>
          Copy layers in Figma, then paste them on the canvas with ⌘V. You can also drop a .fig file
          on the canvas.
        </DialogDescription>
        <div>
          <Button
            id="figma-file"
            type="button"
            variant="outline"
            disabled={busy === "figma-file"}
            onClick={() => void importFile()}
          >
            Open .fig file…
          </Button>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-medium text-foreground">From a link</h3>
          <div className="flex flex-col gap-1.5">
            <Label className="m-0" htmlFor="figma-url">
              Figma design URL
            </Label>
            <Input
              id="figma-url"
              type="url"
              placeholder="https://www.figma.com/design/…?node-id=…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          {connected && (
            <div id="figma-account-choice" className="flex items-center gap-2">
              <Checkbox
                id="figma-use-account"
                checked={useAccount}
                onCheckedChange={(checked) => setUseAccount(checked === true)}
              />
              <Label className="m-0" htmlFor="figma-use-account">
                Use my connected Figma account
              </Label>
            </div>
          )}
          {!(connected && useAccount) && (
            <div id="figma-token-field" className="flex flex-col gap-1.5">
              <Label className="m-0" htmlFor="figma-token">
                Personal access token
              </Label>
              <Input
                id="figma-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A personal access token needs file_content:read permission. It is used for this
                request only and is not saved.
              </p>
            </div>
          )}
          <div>
            <Button
              id="figma-run"
              type="button"
              disabled={busy === "figma-run"}
              onClick={() => void importLink()}
            >
              Import into a new document
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-medium text-foreground">Figma account</h3>
          <p className="text-xs text-muted-foreground">
            Connect with your own Figma OAuth app. Register{" "}
            <code id="figma-redirect" className="break-all text-foreground">
              {account?.redirectUri ?? "http://127.0.0.1:47615/figma/callback"}
            </code>{" "}
            as its redirect URL.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label className="m-0" htmlFor="figma-client-id">
              Client ID
            </Label>
            <Input
              id="figma-client-id"
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="m-0" htmlFor="figma-client-secret">
              Client secret (only if your app requires one)
            </Label>
            <Input
              id="figma-client-secret"
              type="password"
              autoComplete="off"
              placeholder={
                account
                  ? account.hasClientSecret
                    ? "Saved securely"
                    : "Not saved"
                  : "Not saved yet"
              }
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="m-0" htmlFor="figma-port">
              Redirect port
            </Label>
            <Input
              id="figma-port"
              type="number"
              min={1024}
              max={65535}
              step={1}
              value={port}
              onChange={(event) => setPort(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              id="figma-oauth-save"
              type="button"
              variant="outline"
              disabled={busy === "figma-oauth-save"}
              onClick={accountAction("figma-oauth-save", async (desktop) => {
                await saveAccount(desktop);
                await refreshAccount();
              })}
            >
              Save
            </Button>
            <Button
              id="figma-connect"
              type="button"
              disabled={busy === "figma-connect"}
              onClick={accountAction("figma-connect", async (desktop) => {
                await saveAccount(desktop);
                setAccountText("Waiting for Figma in your browser…");
                await desktop.figmaOAuth.connect();
                await refreshAccount();
              })}
            >
              {connected ? "Reconnect" : "Connect account"}
            </Button>
            {connected && (
              <Button
                id="figma-disconnect"
                type="button"
                variant="outline"
                disabled={busy === "figma-disconnect"}
                onClick={accountAction("figma-disconnect", async (desktop) => {
                  await desktop.figmaOAuth.disconnect();
                  await refreshAccount();
                })}
              >
                Disconnect
              </Button>
            )}
          </div>
          <p
            id="figma-account-status"
            role="status"
            className="min-h-4 text-xs text-muted-foreground"
          >
            {accountText}
          </p>
        </section>
        <pre
          id="figma-status"
          role="status"
          className="max-h-50 overflow-auto font-sans text-xs whitespace-pre-wrap text-muted-foreground"
        >
          {status}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
