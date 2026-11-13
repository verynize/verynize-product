// The responsive preview and Import HTML dialog (`#modal`), a shadcn Dialog rendered by this island. Opened by the
// legacy #preview / #import commands (web/app.js dispatches `bd:open-modal` {mode}).
// - Preview: the exported page (window.design.exportHTML) in a sandboxed frame, scripts off unless the page has a
//   shader (the trusted shader runtime), with a viewport width picker.
// - Import: pasted HTML. On the desktop it goes through the main-process importer (desktop/html-import.cjs ->
//   integrations/codec-html.mjs: stylesheets relative to a chosen file, the CSS cascade for a viewport, :root
//   variables) and can import an .html file; the browser build keeps the in-page importer (window.design.importHTML).
// Ids are the legacy ones (tests use them); #modal is the dialog content, present only while open.
import { useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { activePage, useWindowEvent, type DesignDocument } from "@/lib/bridge";
import { can, platform } from "@/lib/platform";
import { cn } from "@/lib/utils";

type Mode = "preview" | "import";
type ImportResult = {
  document: DesignDocument;
  rootIds?: string[];
  warnings?: string[];
  stats?: { elements?: number };
  file?: string;
} | null;
type ImportOptions = {
  document: DesignDocument;
  pageId: string;
  viewport: { width: number; height: number };
  allowRemote: boolean;
};
type NativeImporter = {
  importHtml(options: ImportOptions & { html: string }): Promise<ImportResult>;
  importHtmlFile(options: ImportOptions): Promise<ImportResult>;
};
type ImportApi = {
  exportHTML(): string;
  importHTML(html: string): number;
  loadDocument(document: DesignDocument): void;
};

// Frame widths: literal classes (tokens in globals.css).
const WIDTHS = {
  responsive: { label: "Responsive", className: "w-full" },
  phone: { label: "Phone · 390", className: "w-preview-phone" },
  tablet: { label: "Tablet · 768", className: "w-preview-tablet" },
  desktop: { label: "Desktop · 1000", className: "w-preview-desktop" },
} as const;
type Width = keyof typeof WIDTHS;
const VIEWPORTS = [
  ["1440x900", "Desktop · 1440"],
  ["1280x800", "Laptop · 1280"],
  ["768x1024", "Tablet · 768"],
  ["390x844", "Phone · 390"],
] as const;

const editor = () => window.design as unknown as ImportApi & typeof window.design;
const nativeImporter = (): NativeImporter | null =>
  can("htmlImport") ? (platform.desktop as unknown as NativeImporter) : null;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function PreviewImportDialog() {
  const source = useRef<HTMLTextAreaElement>(null);
  // The pasted HTML survives closing the dialog, like the legacy textarea.
  const draft = useRef("");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("preview");
  const [srcdoc, setSrcdoc] = useState("");
  const [scripts, setScripts] = useState(false);
  const [width, setWidth] = useState<Width>("responsive");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewport, setViewport] = useState<string>(VIEWPORTS[0][0]);
  const [remote, setRemote] = useState(false);
  const native = nativeImporter();
  const importing = mode === "import";

  useWindowEvent("bd:open-modal", (event) => {
    const next: Mode =
      (event as CustomEvent<{ mode?: Mode }>).detail?.mode === "import" ? "import" : "preview";
    const shader = activePage(editor().getDocument()).nodes.some((node) => node.type === "shader");
    setMode(next);
    if (next === "import")
      setStatus(
        "Imports nested inline layouts and text. Scripts, external CSS, and app behavior are excluded.",
      );
    else {
      setScripts(shader);
      setSrcdoc(editor().exportHTML());
      setStatus(
        shader
          ? "Trusted shader runtime runs in an isolated preview. Imported scripts are excluded."
          : "Resize the viewport to check layout. Scripts are disabled.",
      );
    }
    setOpen(true);
  });

  const close = () => {
    draft.current = source.current?.value ?? draft.current;
    setOpen(false);
  };

  const options = (): ImportOptions => {
    const [w, h] = viewport.split("x").map(Number);
    const document = editor().getDocument();
    return {
      document,
      pageId: document.activePage,
      viewport: { width: w, height: h },
      allowRemote: remote,
    };
  };

  const run = async (task: () => Promise<ImportResult>) => {
    if (busy) return;
    setBusy(true);
    setStatus("Importing…");
    try {
      const result = await task();
      if (!result) {
        setStatus("");
        return;
      }
      editor().loadDocument(result.document);
      editor().setSelection(result.rootIds ?? []);
      const notes = result.warnings ?? [];
      const summary = `Imported ${result.stats?.elements ?? ""} elements${result.file ? ` from ${result.file}` : ""}${
        notes.length
          ? ` · ${notes.length} note${notes.length === 1 ? "" : "s"}: ${notes.slice(0, 3).join(" · ")}`
          : ""
      }`;
      setStatus(summary);
      close();
      // Import notes (CSS without a canvas equivalent) stay readable after the dialog closes.
      toast(summary, { duration: notes.length ? 12000 : 4000 });
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const html = source.current?.value ?? "";
    if (native) {
      void run(() => native.importHtml({ ...options(), html }));
      return;
    }
    try {
      editor().importHTML(html);
      close();
    } catch (error) {
      setStatus(message(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        id="modal"
        // Opened from menus: the menu returning focus to its trigger must not dismiss it (a click outside or
        // Escape still does).
        onFocusOutside={(event) => event.preventDefault()}
        className="max-h-(--spacing-dialog-max) max-w-6xl overflow-y-auto sm:max-w-6xl"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (importing) source.current?.focus();
        }}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle id="modal-title">
              {importing ? "Import HTML" : "Responsive preview"}
            </DialogTitle>
          </div>
          {!importing && (
            <Select value={width} onValueChange={(value) => setWidth(value as Width)}>
              <SelectTrigger id="preview-width" aria-label="Preview width" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(WIDTHS).map(([value, { label }]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            id="close"
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>
        <DialogDescription id="status" role="status">
          {status}
        </DialogDescription>
        {importing ? (
          <>
            <Textarea
              id="source"
              ref={source}
              spellCheck={false}
              defaultValue={draft.current}
              className="h-85"
              placeholder={
                native
                  ? "Paste HTML (with <style> or Tailwind classes), or choose a file to resolve its stylesheets"
                  : "Paste HTML with inline styles"
              }
            />
            {native && (
              <div id="html-import-options" className="flex flex-wrap items-center gap-3">
                <Select value={viewport} onValueChange={setViewport}>
                  <SelectTrigger id="import-viewport" aria-label="Import viewport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIEWPORTS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="import-remote"
                    checked={remote}
                    onCheckedChange={(checked) => setRemote(checked === true)}
                  />
                  <Label className="m-0" htmlFor="import-remote">
                    Load remote stylesheets
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  id="import-file"
                  disabled={busy}
                  onClick={() => void run(() => native.importHtmlFile(options()))}
                >
                  Choose HTML file…
                </Button>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" id="apply" disabled={busy} onClick={apply}>
                Import editable layers
              </Button>
            </div>
          </>
        ) : (
          // A new frame per sandbox value: the flags are in place before the document loads.
          <iframe
            key={scripts ? "scripts" : "static"}
            id="frame"
            sandbox={scripts ? "allow-scripts" : ""}
            title="Exported design preview"
            srcDoc={srcdoc}
            className={cn(
              "mx-auto block h-preview-frame max-w-full rounded-lg border border-card-border bg-preview-page",
              WIDTHS[width].className,
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
