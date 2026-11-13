// Variables (design/wonder 11, 41, 42): collapsible header with count, search, `+` create menu, then one group
// per type. Slash names (`surface/base`) nest in collapsible folders; rows and folders have a context menu
// (Rename, Reference variable / Change reference, Detach reference, Delete).
import { useState, type ReactNode } from "react";
import {
  Baseline,
  Braces,
  ChevronRight,
  Copy,
  Diamond,
  Download,
  Folder,
  Hash,
  Link2,
  Palette,
  Pencil,
  Ruler,
  Search,
  Trash2,
  Type,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { PlusIcon } from "@/components/icons";
import { useDesign, type DesignDocument } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorPopover } from "./color-picker";
import { Field, IconButton, NativeSelect, Swatch, type IconType } from "./controls";
import { saveFile } from "./export";
import { createColorToken } from "./legacy";
import { FONTS, WEIGHTS } from "./model";
import {
  aliasesOf,
  createVariable,
  deleteFolder,
  deleteVariable,
  detachReference,
  folderMembers,
  kindOf,
  leafOf,
  parseValue,
  referenceCandidates,
  referenceVariable,
  renameFolder,
  renameVariable,
  setTokenColor,
  setVariableValue,
  variablesCss,
  variablesOf,
  VARIABLE_TYPES,
  type Variable,
  type VariableKind,
  type VariableType,
} from "./vars";

/** 36px panel header row with a chevron, label and tools (Variables / Properties). */
export function PanelSectionHeader({
  label,
  count,
  open,
  onToggle,
  tools,
  className,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  tools?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-9 shrink-0 items-center gap-2 pr-3 pl-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onToggle}
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="truncate">{label}</span>
        {count ? <span className="text-subtle-foreground">{count}</span> : null}
      </button>
      {tools ? <div className="flex items-center gap-2">{tools}</div> : null}
    </div>
  );
}

const TYPE_ICON: Record<VariableType, IconType> = {
  dimension: Ruler,
  number: Hash,
  fontFamily: Type,
  fontWeight: Baseline,
};

/** Inline name editor shared by variable and folder rows (Enter commits, Escape cancels). */
function RenameInput({
  label,
  initial,
  onDone,
}: {
  label: string;
  initial: string;
  onDone: (next: string | null) => void;
}) {
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={initial}
      className="h-6 min-w-0 flex-1 rounded-md bg-input px-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => {
        const next = event.target.value.trim();
        onDone(next && next !== initial ? next : null);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = initial;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** Value editor of a typed variable (inline field or weight select). */
function TypedValue({ name, variable }: { name: string; variable: Variable }) {
  const commitValue = (raw: string) => {
    const value = parseValue(variable.type, raw);
    if (value === null)
      return variable.type === "fontWeight"
        ? "Use a weight from 100 to 900"
        : "Enter a valid value";
    if (value !== variable.value) setVariableValue(name, value);
    return null;
  };
  return variable.type === "fontWeight" ? (
    <NativeSelect
      label={`${name} value`}
      className="w-24 shrink-0"
      value={String(variable.value)}
      options={WEIGHTS.map(([value, label]) => ({ value, label }))}
      onChange={(value) => commitValue(value)}
    />
  ) : (
    <Field
      label={`${name} value`}
      numeric={variable.type !== "fontFamily"}
      scrub={false}
      value={String(variable.value)}
      className={cn("shrink-0", variable.type === "fontFamily" ? "w-28" : "w-20")}
      inputClassName={variable.type === "fontFamily" ? "" : "text-right"}
      suffix={variable.type === "dimension" ? "px" : undefined}
      list={variable.type === "fontFamily" ? "bd-variable-fonts" : undefined}
      onCommit={commitValue}
    />
  );
}

/** Context menu entries for one variable. */
function VariableMenu({
  doc,
  name,
  onRename,
}: {
  doc: DesignDocument;
  name: string;
  onRename: () => void;
}) {
  const target = aliasesOf(doc)[name];
  const candidates = referenceCandidates(doc, name);
  return (
    <ContextMenuContent className="w-52">
      <ContextMenuItem onSelect={onRename}>
        <Pencil />
        Rename
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!candidates.length} data-reference-menu={name}>
          <Link2 className="mr-2" />
          {target ? "Change reference" : "Reference variable"}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-72 w-52 overflow-y-auto">
          {candidates.map((candidate) => (
            <ContextMenuItem
              key={candidate}
              data-reference-target={candidate}
              onSelect={() => referenceVariable(name, candidate)}
            >
              <span className="min-w-0 flex-1 truncate">{candidate}</span>
              {candidate === target ? <Diamond className="size-3 text-primary-text" /> : null}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {target ? (
        <ContextMenuItem onSelect={() => detachReference(name)}>
          <Unlink />
          Detach reference
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => deleteVariable(name)}>
        <Trash2 />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Chip shown instead of the value when a variable references another one. */
function ReferenceChip({
  doc,
  name,
  target,
}: {
  doc: DesignDocument;
  name: string;
  target: string;
}) {
  const missing = kindOf(doc, target) !== kindOf(doc, name);
  return (
    <span
      data-reference={target}
      title={missing ? `${target} (missing variable)` : `References ${target}`}
      className="flex h-6 max-w-28 min-w-0 shrink-0 items-center gap-1 rounded-md bg-input px-2 text-xs text-foreground shadow-field"
    >
      <Diamond className="size-3 shrink-0 text-primary-text" aria-hidden />
      <span className={cn("min-w-0 truncate", missing && "text-destructive")}>{target}</span>
    </span>
  );
}

/** One colour or typed variable: leaf name (rename on double-click), value or reference, delete. */
function VariableRow({
  doc,
  name,
  kind,
}: {
  doc: DesignDocument;
  name: string;
  kind: VariableKind;
}) {
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);
  const target = aliasesOf(doc)[name];
  const color = kind === "color" ? (doc.tokens[name] ?? "") : "";
  const variable = kind === "color" ? undefined : variablesOf(doc)[name];
  const Icon = kind === "color" ? null : TYPE_ICON[kind];
  const row = (
    <div
      data-color-anchor={kind === "color" ? "" : undefined}
      data-token={kind === "color" ? name : undefined}
      data-variable={kind === "color" ? undefined : name}
      className="group/token flex h-7.5 items-center gap-2 rounded-md pr-1 pl-3 hover:bg-muted"
    >
      {kind === "color" ? (
        <button
          type="button"
          aria-label={`Edit ${name} colour`}
          aria-expanded={open}
          title="Edit colour"
          className="relative flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setOpen(!open)}
        >
          <Swatch color={color} />
        </button>
      ) : Icon ? (
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      {renaming ? (
        <RenameInput
          label={`Rename variable ${name}`}
          initial={name}
          onDone={(next) => {
            setRenaming(false);
            if (next) renameVariable(name, next);
          }}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-xs text-foreground-2"
          title={`${name} · double-click to rename`}
          onDoubleClick={() => setRenaming(true)}
        >
          {leafOf(name) || name}
        </span>
      )}
      {target ? (
        <ReferenceChip doc={doc} name={name} target={target} />
      ) : kind === "color" ? (
        <span className="text-xs text-muted-foreground uppercase group-hover/token:hidden">
          {color}
        </span>
      ) : variable ? (
        <TypedValue name={name} variable={variable} />
      ) : null}
      <IconButton
        icon={Trash2}
        label={`Delete variable ${name}`}
        className="hidden group-hover/token:inline-flex group-focus-within/token:inline-flex"
        onClick={() => deleteVariable(name)}
      />
    </div>
  );
  const withMenu = (child: ReactNode) => (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{child}</ContextMenuTrigger>
      <VariableMenu doc={doc} name={name} onRename={() => setRenaming(true)} />
    </ContextMenu>
  );
  if (kind !== "color") return withMenu(row);
  return (
    <ColorPopover
      open={open}
      onOpenChange={setOpen}
      value={color}
      onCommit={(next) => setTokenColor(name, next)}
    >
      {/* ContextMenuTrigger renders a fragment, so the popover needs its own element to measure. */}
      <div>{withMenu(row)}</div>
    </ColorPopover>
  );
}

/* ---------- Folder tree ---------- */
type Tree = { path: string; folders: Map<string, Tree>; items: string[] };

function buildTree(names: string[]): Tree {
  const root: Tree = { path: "", folders: new Map(), items: [] };
  for (const name of names) {
    const parts = name.split("/");
    const leaf = parts.pop();
    let node = root;
    // Only non-empty segments make folders; odd names (`a//b`, `a/`) stay readable at their level.
    if (leaf)
      for (const part of parts) {
        if (!part) break;
        const path = node.path ? `${node.path}/${part}` : part;
        if (!node.folders.has(part))
          node.folders.set(part, { path, folders: new Map(), items: [] });
        node = node.folders.get(part)!;
      }
    node.items.push(name);
  }
  return root;
}

const countOf = (tree: Tree): number =>
  tree.items.length + [...tree.folders.values()].reduce((sum, t) => sum + countOf(t), 0);

type TreeProps = {
  doc: DesignDocument;
  kind: VariableKind;
  collapsed: Set<string>;
  forceOpen: boolean;
  onToggle: (key: string) => void;
};

function FolderRow({ tree, ...props }: TreeProps & { tree: Tree }) {
  const { doc, kind, collapsed, forceOpen, onToggle } = props;
  const [renaming, setRenaming] = useState(false);
  const key = `${kind}:${tree.path}`;
  const open = forceOpen || !collapsed.has(key);
  const name = tree.path.slice(tree.path.lastIndexOf("/") + 1);
  const members = folderMembers(doc, tree.path, kind).length;
  return (
    <div role="group" aria-label={`Folder ${tree.path}`} data-folder={tree.path}>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <div className="group/folder flex h-7.5 items-center gap-1 rounded-md pr-1 pl-2 hover:bg-muted">
            {renaming ? (
              <>
                <Folder className="ml-4 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <RenameInput
                  label={`Rename folder ${tree.path}`}
                  initial={tree.path}
                  onDone={(next) => {
                    setRenaming(false);
                    if (next) renameFolder(tree.path, next, kind);
                  }}
                />
              </>
            ) : (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} folder ${tree.path}`}
                className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md text-left text-xs text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onToggle(key)}
                onDoubleClick={() => setRenaming(true)}
              >
                <ChevronRight
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-90",
                  )}
                  aria-hidden
                />
                <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="text-subtle-foreground group-hover/folder:hidden">
                  {countOf(tree)}
                </span>
              </button>
            )}
            <IconButton
              icon={Trash2}
              label={`Delete folder ${tree.path}`}
              className="hidden group-hover/folder:inline-flex group-focus-within/folder:inline-flex"
              onClick={() => deleteFolder(tree.path, kind)}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={() => setRenaming(true)}>
            <Pencil />
            Rename folder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => deleteFolder(tree.path, kind)}>
            <Trash2 />
            Delete folder ({members})
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open ? (
        <div className="pl-3">
          <TreeView tree={tree} {...props} />
        </div>
      ) : null}
    </div>
  );
}

function TreeView({ tree, ...props }: TreeProps & { tree: Tree }) {
  return (
    <>
      {[...tree.folders.values()].map((folder) => (
        <FolderRow key={folder.path} tree={folder} {...props} />
      ))}
      {tree.items.map((name) => (
        <VariableRow key={name} doc={props.doc} name={name} kind={props.kind} />
      ))}
    </>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <div className="flex h-7 items-center px-3 text-xs text-foreground-3">{children}</div>;
}

export function VariablesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const doc = useDesign();
  const tokens = Object.keys(doc.tokens ?? {});
  const vars = Object.entries(variablesOf(doc));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const q = query.trim().toLowerCase();
  // Search matches names only (folder path included), not values.
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const groups: { kind: VariableKind; label: string; names: string[] }[] = [
    { kind: "color", label: "Colors", names: tokens.filter(match) },
    ...VARIABLE_TYPES.map(({ type, group }) => ({
      kind: type as VariableKind,
      label: group,
      names: vars.filter(([name, v]) => v.type === type && match(name)).map(([name]) => name),
    })),
  ];
  const shown = groups.reduce((sum, g) => sum + g.names.length, 0);
  const total = tokens.length + vars.length;
  const toggleFolder = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const reveal = () => {
    if (!open) onToggle();
  };
  const css = () => variablesCss(window.design.getDocument());
  return (
    <section
      id="insp-variables"
      className={cn(
        "flex flex-col border-b border-divider",
        // Panel accordion (inspector.tsx): an open section fills the space, collapsed ones keep their header height.
        open ? "min-h-24 flex-1" : "min-h-9 shrink-0",
      )}
    >
      <PanelSectionHeader
        label="Variables"
        count={total}
        open={open}
        onToggle={onToggle}
        className="h-9"
        tools={
          <>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton
                  id="variables-css"
                  icon={Braces}
                  label="Export variables as CSS"
                  disabled={!total}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-48">
                <DropdownMenuItem
                  id="copy-variables-css"
                  onSelect={async () => {
                    try {
                      await copyText(css());
                      toast.success(
                        `Copied ${total} ${total === 1 ? "variable" : "variables"} as CSS`,
                      );
                    } catch (error) {
                      toast.error("Export failed", {
                        description: error instanceof Error ? error.message : String(error),
                      });
                    }
                  }}
                >
                  <Copy />
                  Copy as CSS
                </DropdownMenuItem>
                <DropdownMenuItem
                  id="save-variables-css"
                  onSelect={async () => {
                    try {
                      const saved = await saveFile(
                        `${doc.name || "design"}-variables`,
                        css(),
                        "css",
                      );
                      if (saved) toast.success("Exported CSS variables", { description: saved });
                    } catch (error) {
                      toast.error("Export failed", {
                        description: error instanceof Error ? error.message : String(error),
                      });
                    }
                  }}
                >
                  <Download />
                  Save CSS file…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              icon={Search}
              label="Search variables"
              active={searching}
              onClick={() => {
                setSearching(!searching);
                reveal();
                if (searching) setQuery("");
              }}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton id="add-token" icon={PlusIcon} label="Create variable" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-44">
                <DropdownMenuItem
                  id="add-color-token"
                  onSelect={async () => {
                    if (await createColorToken()) reveal();
                  }}
                >
                  <Palette />
                  Colors
                </DropdownMenuItem>
                {VARIABLE_TYPES.map(({ type, label }) => {
                  const Icon = TYPE_ICON[type];
                  return (
                    <DropdownMenuItem
                      key={type}
                      id={`add-${type}-variable`}
                      onSelect={async () => {
                        if (await createVariable(type)) reveal();
                      }}
                    >
                      <Icon />
                      {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div hidden={!open} data-scroll className="min-h-0 flex-1 overflow-y-auto pb-2">
        <datalist id="bd-variable-fonts">
          {FONTS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        {searching ? (
          <div className="px-3 pb-2">
            <input
              autoFocus
              aria-label="Search variables"
              placeholder="Search variables"
              value={query}
              className="h-6 w-full rounded-md bg-input px-2 text-xs text-foreground shadow-field outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
            />
          </div>
        ) : null}
        {total ? (
          <>
            {groups.map(({ kind, label, names }) =>
              names.length ? (
                <div key={kind} role="group" aria-label={label}>
                  <GroupLabel>{label}</GroupLabel>
                  <TreeView
                    tree={buildTree(names)}
                    doc={doc}
                    kind={kind}
                    collapsed={collapsed}
                    forceOpen={!!q}
                    onToggle={toggleFolder}
                  />
                </div>
              ) : null,
            )}
            {!shown ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No variable names contain “{query.trim()}”
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2.5 px-4 pt-8 pb-4 text-center">
            <Diamond className="size-4 text-foreground-3" aria-hidden />
            <p className="text-xs text-foreground-3">
              Variables let you reuse colours, sizes and type across this file. Use the + above to
              create one.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}
