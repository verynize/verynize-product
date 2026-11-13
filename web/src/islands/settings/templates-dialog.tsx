// The Templates dialog (`#templates-dialog`), a shadcn Dialog rendered by this island in place of the markup and
// handlers of web/views-templates.js, which keeps the templates, the component library and packs
// (`window.designTemplates`) and the #templates-open command (it dispatches `bd:open-templates`).
// Built-in starting points and saved templates (search, categories, preview, use, delete), the shared component
// library (insert, delete, publish instance changes, update instances) and template packs (import, export).
// Ids and data attributes are the legacy ones (tests use them).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDesign, useWindowEvent, type DesignDocument, type LayerNode } from "@/lib/bridge";
import { DocumentPreview } from "./document-preview";

type Category = "all" | "website" | "app" | "presentation" | "mine" | "components";
type BuiltIn = { id: string; name: string; description: string; category: Category };
type UserTemplate = {
  id: string;
  name: string;
  description: string;
  category: Category;
  createdAt: number;
  document: DesignDocument;
};
type Component = { id: string; name: string; version: number; nodes: LayerNode[] };
type Templates = {
  builtIn: BuiltIn[];
  categories: { id: Category; label: string }[];
  create(id: string): DesignDocument;
  userTemplates(): UserTemplate[];
  saveTemplate(entry: { name: string; document: DesignDocument }): unknown;
  deleteTemplate(id: string): void;
  templateFromSelection(name: string): DesignDocument;
  reidDocument(document: DesignDocument): DesignDocument;
  library: {
    list(): Component[];
    add(name: string): Component;
    insert(id: string): void;
    publish(): Component;
    updateInstances(): number;
    remove(id: string): void;
  };
  importFile(file: File): Promise<{ templates: number; components: number }>;
  downloadPack(): Promise<string>;
};

const templates = () => (window as unknown as { designTemplates: Templates }).designTemplates;
const library = () =>
  window.fileLibrary as unknown as {
    createFromDocument(document: DesignDocument): Promise<unknown>;
  };
const pageLoader = () =>
  (window as unknown as { pageLoader?: { ensureAll(): Promise<unknown> } }).pageLoader;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Tile({
  preview,
  title,
  description,
  children,
  ...data
}: {
  preview: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <article
      {...data}
      className="flex flex-col overflow-hidden rounded-lg border border-card-border bg-card"
    >
      <div className="flex h-37 items-center justify-center bg-background p-3">{preview}</div>
      <div className="flex flex-col gap-1 p-3">
        <strong className="truncate text-sm font-medium text-foreground">{title}</strong>
        <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
      </div>
    </article>
  );
}

export function TemplatesDialog() {
  const doc = useDesign();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const [previewing, setPreviewing] = useState<{ name: string; document: DesignDocument } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  useWindowEvent("bd:open-templates", () => setOpen(true));
  useWindowEvent("design-templates-changed", () => setRevision((count) => count + 1));
  // Built-in documents are generated once per opening, for their previews.
  const builtIns = useMemo(
    () =>
      open
        ? templates().builtIn.map((entry) => ({ ...entry, document: templates().create(entry.id) }))
        : [],
    [open],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` re-reads localStorage-backed lists.
  const saved = useMemo(() => (open ? templates().userTemplates() : []), [open, revision]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const components = useMemo(() => (open ? templates().library.list() : []), [open, revision]);
  useEffect(() => {
    if (!open) setPreviewing(null);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = (entryCategory: Category, text: string) =>
    (category === "all" || entryCategory === category) && (!q || text.toLowerCase().includes(q));
  const used = new Map<string, number[]>();
  for (const page of doc.pages)
    for (const node of page.nodes) {
      const link = node.libraryComponent as { id: string; version: number } | undefined;
      if (link) used.set(link.id, [...(used.get(link.id) ?? []), link.version]);
    }

  const useDocument = async (next: DesignDocument) => {
    await library().createFromDocument(next);
    setOpen(false);
    window.document.getElementById("zoom-fit")?.click();
  };
  const guarded = (id: string, task: () => Promise<string> | string) => async () => {
    setBusy(id);
    try {
      const result = await task();
      if (result) setStatus(result);
      setRevision((count) => count + 1);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(null);
    }
  };
  const ask = (title: string, value: string) =>
    window.askText?.(title, value) ?? Promise.resolve(null);
  const selected = () => window.design.getSelection().length > 0;

  const actions: { id: string; label: string; run: () => Promise<string> | string }[] = [
    {
      id: "template-save-document",
      label: "Save document as template",
      run: async () => {
        await pageLoader()?.ensureAll();
        const document = window.design.getDocument();
        const name = await ask("Template name", document.name || "My template");
        if (!name?.trim()) return "";
        templates().saveTemplate({ name, document });
        return `Saved “${name.trim()}” to My templates`;
      },
    },
    {
      id: "template-save-selection",
      label: "Save selection as template",
      run: async () => {
        if (!selected()) throw Error("Select layers to save as a template.");
        const name = await ask("Template name", "Selection");
        if (!name?.trim()) return "";
        templates().saveTemplate({ name, document: templates().templateFromSelection(name) });
        return `Saved “${name.trim()}” to My templates`;
      },
    },
    {
      id: "component-add",
      label: "Add selection to library",
      run: async () => {
        if (!selected()) throw Error("Select a layer to add to the library.");
        const name = await ask("Component name", "Component");
        if (!name?.trim()) return "";
        return `Added “${templates().library.add(name).name}” to the library`;
      },
    },
    {
      id: "component-publish",
      label: "Publish instance changes",
      run: () => {
        const component = templates().library.publish();
        return `Published “${component.name}” version ${component.version}`;
      },
    },
    {
      id: "component-update-instances",
      label: "Update instances",
      run: async () => {
        await pageLoader()?.ensureAll();
        const count = templates().library.updateInstances();
        return count
          ? `Updated ${count} instance${count === 1 ? "" : "s"}`
          : "Every instance is up to date";
      },
    },
    { id: "template-import", label: "Import pack…", run: () => (fileInput.current?.click(), "") },
    { id: "template-export", label: "Export pack", run: () => templates().downloadPack() },
  ];

  const showComponents = category === "components" || (category === "all" && !!q);
  const visibleComponents = components.filter((c) => !q || c.name.toLowerCase().includes(q));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        id="templates-dialog"
        // Opened from menus: the menu returning focus to its trigger must not dismiss it (a click outside or
        // Escape still does).
        onFocusOutside={(event) => event.preventDefault()}
        showCloseButton={false}
        className="max-h-(--spacing-dialog-max) max-w-(--spacing-templates) overflow-y-auto sm:max-w-(--spacing-templates)"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.document.getElementById("template-search")?.focus();
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <small className="text-xs text-primary-text">Start something new</small>
            <DialogTitle>Templates</DialogTitle>
          </div>
          <Button
            id="templates-close"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <XIcon />
          </Button>
        </div>
        <DialogDescription>
          Original starting points and your own saved designs. Every frame, shape and text layer is
          editable.
        </DialogDescription>

        <Tabs value={category} onValueChange={(value) => setCategory(value as Category)}>
          <TabsList className="w-full">
            {templates()?.categories.map(({ id, label }) => (
              <TabsTrigger key={id} value={id} data-template-category={id}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="template-search"
            type="search"
            className="w-64"
            placeholder="Search templates and components"
            aria-label="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {actions.map(({ id, label, run }) => (
            <Button
              key={id}
              id={id}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy === id}
              onClick={guarded(id, run)}
            >
              {label}
            </Button>
          ))}
          <input
            id="template-import-file"
            ref={fileInput}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            hidden
            onChange={guarded("template-import", async () => {
              const file = fileInput.current?.files?.[0];
              if (fileInput.current) fileInput.current.value = "";
              if (!file) return "";
              const result = await templates().importFile(file);
              return `Imported ${result.templates} templates and ${result.components} components`;
            })}
          />
        </div>

        {previewing && (
          <section
            id="template-preview"
            className="flex gap-4 rounded-lg border border-card-border p-3"
          >
            <div id="template-preview-art" className="w-120 shrink-0 bg-background">
              <DocumentPreview
                document={previewing.document}
                width={480}
                height={296}
                className="w-full"
              />
            </div>
            <div className="flex flex-col gap-2">
              <strong id="template-preview-name" className="text-sm font-medium text-foreground">
                {previewing.name}
              </strong>
              <Button
                id="template-preview-use"
                size="sm"
                onClick={() =>
                  void useDocument(templates().reidDocument(previewing.document)).catch((error) =>
                    setStatus(message(error)),
                  )
                }
              >
                Use template
              </Button>
              <Button
                id="template-preview-close"
                variant="outline"
                size="sm"
                onClick={() => setPreviewing(null)}
              >
                Close preview
              </Button>
            </div>
          </section>
        )}

        {category !== "components" && (
          <div id="template-grid" className="grid grid-cols-3 gap-3">
            {builtIns
              .filter((entry) => matches(entry.category, `${entry.name} ${entry.description}`))
              .map((entry) => (
                <Tile
                  key={entry.id}
                  data-template-card={entry.id}
                  preview={<DocumentPreview document={entry.document} className="h-full w-full" />}
                  title={entry.name}
                  description={entry.description}
                >
                  <Button
                    size="sm"
                    data-template={entry.id}
                    data-category={entry.category}
                    disabled={busy === entry.id}
                    onClick={guarded(entry.id, async () => {
                      await useDocument(templates().create(entry.id));
                      return "";
                    })}
                  >
                    Use template
                  </Button>
                </Tile>
              ))}
            {saved
              .filter(
                (t) =>
                  (category === "all" || category === "mine" || t.category === category) &&
                  (!q || `${t.name} ${t.description}`.toLowerCase().includes(q)),
              )
              .map((t) => (
                <Tile
                  key={t.id}
                  data-user-template={t.id}
                  data-category={t.category}
                  preview={<DocumentPreview document={t.document} className="h-full w-full" />}
                  title={t.name}
                  description={
                    t.description || `Saved ${new Date(t.createdAt).toLocaleDateString()}`
                  }
                >
                  <Button
                    size="sm"
                    data-action="use"
                    onClick={() =>
                      void useDocument(templates().reidDocument(t.document)).catch((error) =>
                        setStatus(message(error)),
                      )
                    }
                  >
                    Use
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-action="preview"
                    onClick={() => setPreviewing(t)}
                  >
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="delete"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => {
                      templates().deleteTemplate(t.id);
                      setStatus(`Deleted ${t.name}`);
                    }}
                  >
                    Delete
                  </Button>
                </Tile>
              ))}
          </div>
        )}

        {showComponents && (
          <div id="template-library-list" className="grid grid-cols-3 gap-3">
            {visibleComponents.map((c) => {
              const versions = used.get(c.id) ?? [];
              const outdated = versions.filter((v) => v < c.version).length;
              return (
                <Tile
                  key={c.id}
                  data-component={c.id}
                  data-version={String(c.version)}
                  preview={
                    <DocumentPreview
                      document={{
                        version: 2,
                        name: c.name,
                        activePage: "p",
                        pages: [{ id: "p", name: "", nodes: c.nodes }],
                        tokens: doc.tokens ?? {},
                      }}
                      className="h-full w-full"
                    />
                  }
                  title={c.name}
                  description={`Version ${c.version} · ${versions.length} in this file${outdated ? ` · ${outdated} outdated` : ""}`}
                >
                  <Button
                    size="sm"
                    data-action="insert"
                    onClick={() => {
                      try {
                        templates().library.insert(c.id);
                        setOpen(false);
                      } catch (error) {
                        setStatus(message(error));
                      }
                    }}
                  >
                    Insert
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="delete"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => templates().library.remove(c.id)}
                  >
                    Delete
                  </Button>
                </Tile>
              );
            })}
            {category === "components" && !visibleComponents.length && (
              <p className="col-span-3 text-xs text-muted-foreground">
                No components yet. Select a layer and choose “Add selection to library”.
              </p>
            )}
          </div>
        )}

        <p id="template-status" role="status" className="min-h-4 text-xs text-muted-foreground">
          {status}
        </p>
      </DialogContent>
    </Dialog>
  );
}
