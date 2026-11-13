// Typography (design/wonder 25–27, properties-audit A10): font family picker, weight names, size, line height
// (a ratio or Auto), letter spacing, horizontal + vertical alignment, and the Type settings popover (case, wrap,
// whitespace, truncation, word break, indent, smoothing, decoration). Text is edited on the canvas.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Diamond,
  Minus,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  X,
} from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import {
  FontSizeIcon,
  LineHeightIcon,
  SlidersIcon,
  TextAlignBottomIcon,
  TextAlignMiddleIcon,
  TextAlignTopIcon,
  TextIndentIcon,
} from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn, textOf } from "@/lib/utils";
import {
  Affix,
  Caption,
  Field,
  IconAffix,
  IconButton,
  NativeSelect,
  Section,
  Segmented,
} from "./controls";
import { notify } from "./legacy";
import { WEIGHTS, fmt, pageNodes, patchNodes, setField, weightName, type Node } from "./model";
import { BindableField, VariableChip } from "./bind";
import {
  ALL_WEIGHTS,
  isUnsupportedFont,
  loadCatalog,
  loadLocalFonts,
  nearestWeight,
  previewFont,
  previewFonts,
  weightsFor,
  type FontEntry,
} from "./fonts";
import { bindVariable, bindingsOf, variablesOf } from "./vars";

const pickerTrigger =
  "flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded-md bg-input pr-2 pl-2 text-xs text-foreground shadow-field outline-none hover:ring-1 hover:ring-accent focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:ring-1 data-[state=open]:ring-primary";

/** Family name rendered in its own typeface (dynamic font-family set through the DOM, no inline style props). */
function FontName({ family, className }: { family: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current)
      ref.current.style.fontFamily = `"${family.replace(/"/g, "")}", var(--font-sans)`;
  }, [family]);
  return (
    <span ref={ref} className={cn("truncate", className)}>
      {family}
    </span>
  );
}

/** Fonts revealed per infinite-scroll page (also the most families one `fontFaces` call loads). */
const PAGE = 40;
const KIND_LABEL: Record<FontEntry["kind"], string> = {
  bundled: "Bundled",
  system: "System",
  generic: "Generic",
  web: "Google Fonts",
  local: "Installed",
};

export function FontFamilyPicker({
  doc,
  node,
  selection,
  fonts,
  onLocalFonts,
  onChoose,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  fonts: FontEntry[];
  onLocalFonts: () => void;
  /** Apply the chosen family somewhere other than the selected layers (a preview element); hides variables. */
  onChoose?: (family: string) => void;
}) {
  const value = node.fontFamily;
  // Wonder PM3: a family Verynize cannot offer reads "<family> (unsupported)".
  const unsupported = isUnsupportedFont(value, fonts, { generic: !onChoose });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // All = Google + system fonts, Custom = fonts installed on this Mac, Variable = fontFamily variables.
  const [source, setSource] = useState<"all" | "custom" | "variable">("all");
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // A state ref: the popover content mounts after the picker renders, so the observer waits for the row itself.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();
  const familyVars = onChoose
    ? []
    : Object.entries(variablesOf(doc)).filter(([, v]) => v.type === "fontFamily");
  const bound = bindingsOf(node).fontFamily;
  // Joined so the memo below only recomputes when the set of families on the page changes.
  const usedKey = [
    ...new Set(
      pageNodes(doc)
        .map((n) => n.fontFamily)
        .filter(Boolean),
    ),
  ].join("\u0000");
  const matches = useMemo(() => {
    const seen = new Set<string>();
    const out: FontEntry[] = [];
    const add = (f: FontEntry) => {
      const key = f.family.toLowerCase();
      if (
        seen.has(key) ||
        (q && !key.includes(q)) ||
        (f.kind === "local") !== (source === "custom")
      )
        return;
      seen.add(key);
      out.push(f);
    };
    if (source === "all")
      for (const family of [value, ...(usedKey ? usedKey.split("\u0000") : [])])
        add(
          fonts.find((f) => f.family.toLowerCase() === family.toLowerCase()) ?? {
            family,
            kind: "system",
            weights: ALL_WEIGHTS,
          },
        );
    for (const f of fonts) add(f);
    // Prefix matches first when searching.
    return q
      ? out.sort(
          (a, b) =>
            Number(!a.family.toLowerCase().startsWith(q)) -
            Number(!b.family.toLowerCase().startsWith(q)),
        )
      : out;
  }, [fonts, q, source, value, usedKey]);
  const varMatches = familyVars.filter(
    ([name, v]) =>
      !q || name.toLowerCase().includes(q) || String(v.value).toLowerCase().includes(q),
  );
  const shown = source === "variable" ? [] : matches.slice(0, limit);
  const more = source !== "variable" && matches.length > limit;
  const count = source === "variable" ? varMatches.length : shown.length;
  const current = shown[Math.min(active, shown.length - 1)];
  const currentVar = source === "variable" ? varMatches[Math.min(active, count - 1)] : undefined;
  const applyVariable = (name: string | null) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    bindVariable(doc, selection, "fontFamily", name);
  };
  // A new search or tab starts again at the first page, with its previews loaded.
  const pageKey = `${open}\u0000${source}\u0000${q}`;
  const pageKeyRef = useRef(pageKey);
  useLayoutEffect(() => {
    pageKeyRef.current = pageKey;
  });
  useEffect(() => {
    setLimit(PAGE);
    setLoading(false);
    if (open && source !== "variable") void previewFonts(matches.slice(0, PAGE));
  }, [pageKey, fonts]);
  // Infinite scroll: when the bottom row comes into view, fetch the next page's previews, then show it.
  useEffect(() => {
    if (!sentinel || !more || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setLoading(true);
        const key = pageKey;
        const next = matches.slice(limit, limit + PAGE);
        void Promise.race([
          previewFonts(next),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]).then(() => {
          if (pageKeyRef.current !== key) return;
          setLimit((n) => n + PAGE);
          setLoading(false);
        });
      },
      { root: list.current, rootMargin: "0px 0px 120px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, more, loading, limit, matches, pageKey]);
  useEffect(() => {
    if (current) void previewFont(current);
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, active]);
  const choose = (family: string) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    family = family.trim();
    if (!family || (family === value && !bound)) return;
    if (onChoose) return onChoose(family);
    const weights = weightsFor(family, fonts);
    patchNodes(selection, (n) => {
      const b = { ...bindingsOf(n) };
      delete b.fontFamily;
      const weight = Number(n.fontWeight) || 400;
      const fontWeight =
        weights.includes(weight) || bindingsOf(n).fontWeight
          ? n.fontWeight
          : String(nearestWeight(weights, weight));
      return { fontFamily: family, fontWeight, bindings: Object.keys(b).length ? b : undefined };
    });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          onLocalFonts();
          setSource(bound && !onChoose ? "variable" : "all");
          setActive(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Font family"
          className={pickerTrigger}
          data-bound={bound ? "fontFamily" : undefined}
        >
          {bound ? (
            <VariableChip
              name={bound}
              missing={!familyVars.some(([name]) => name === bound)}
              className="ml-0.75"
            />
          ) : (
            <>
              <span className="truncate" data-font-unsupported={unsupported || undefined}>
                {unsupported ? `${value} (unsupported)` : value}
              </span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        collisionPadding={8}
        className="w-72"
        id="font-family-picker"
      >
        <div className="-m-1.5 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              aria-label="Search fonts"
              placeholder="Search fonts"
              value={query}
              role="combobox"
              aria-expanded
              aria-controls="font-family-list"
              aria-activedescendant={current || currentVar ? `font-option-${active}` : undefined}
              className="h-7 min-w-0 flex-1 rounded-md bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((i) =>
                    Math.max(0, Math.min(count - 1, i + (event.key === "ArrowDown" ? 1 : -1))),
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (source !== "variable") choose(current?.family ?? query);
                  else if (currentVar) applyVariable(currentVar[0]);
                }
              }}
            />
            <IconButton icon={X} label="Close font picker" onClick={() => setOpen(false)} />
          </div>
          <div
            role="tablist"
            aria-label="Font source"
            className="flex h-6 gap-0.5 rounded-md bg-muted p-0.5"
          >
            {(onChoose
              ? (["all", "custom"] as const)
              : (["all", "custom", "variable"] as const)
            ).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={source === k}
                className="flex-1 rounded-sm text-2xs text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:text-foreground"
                onClick={() => {
                  setSource(k);
                  setActive(0);
                }}
              >
                {k === "all" ? "All" : k === "custom" ? "Custom" : "Variable"}
              </button>
            ))}
          </div>
          <div
            ref={list}
            id="font-family-list"
            role="listbox"
            aria-label="Fonts"
            className="max-h-80 min-h-40 overflow-y-auto"
          >
            {source === "variable"
              ? varMatches.map(([name, v], i) => (
                  <button
                    key={name}
                    id={`font-option-${i}`}
                    data-index={i}
                    data-variable={name}
                    type="button"
                    role="option"
                    aria-selected={name === bound}
                    data-active={i === active || undefined}
                    className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent data-active:bg-accent"
                    onPointerEnter={() => setActive(i)}
                    onClick={() => applyVariable(name)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Diamond className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{name}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-2xs text-subtle-foreground">
                      <FontName family={String(v.value)} />
                      {name === bound ? (
                        <Check className="size-3.5 shrink-0 text-foreground-3" aria-hidden />
                      ) : null}
                    </span>
                  </button>
                ))
              : null}
            {source === "variable" && bound ? (
              <button
                type="button"
                className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent"
                onClick={() => applyVariable(null)}
              >
                Detach variable
              </button>
            ) : null}
            {source === "variable" && !varMatches.length ? (
              <p className="px-2 py-1.5 text-2xs text-subtle-foreground">
                {q ? "No matching font variables" : "No font family variables in this document"}
              </p>
            ) : null}
            {source === "custom" && !matches.length && !q ? (
              <p className="px-2 py-1.5 text-2xs text-subtle-foreground">
                No fonts installed on this device were found
              </p>
            ) : null}
            {shown.map((font, i) => (
              <button
                key={font.family}
                id={`font-option-${i}`}
                data-index={i}
                data-family={font.family}
                type="button"
                role="option"
                aria-selected={font.family === value}
                data-active={i === active || undefined}
                className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent data-active:bg-accent"
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(font.family)}
              >
                <FontName family={font.family} className="text-sm" />
                <span className="flex shrink-0 items-center gap-1 text-2xs text-subtle-foreground">
                  {KIND_LABEL[font.kind]}
                  {font.family === value ? (
                    <Check className="size-3.5 text-foreground-3" aria-hidden />
                  ) : null}
                </span>
              </button>
            ))}
            {source !== "variable" && !shown.length && q ? (
              <button
                type="button"
                className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent"
                onClick={() => choose(query.trim())}
              >
                Use “{query.trim()}”
              </button>
            ) : null}
            {more ? (
              <div
                ref={setSentinel}
                data-font-list-more
                className="flex h-8 items-center justify-center text-muted-foreground"
              >
                <Spinner className="size-3.5" />
              </div>
            ) : null}
          </div>
          {current ? (
            <div className="flex h-9 items-center border-t border-border px-2" aria-hidden>
              <FontName family={current.family} className="text-base text-foreground" />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FontWeightPicker({
  doc,
  node,
  selection,
  weights,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  weights: number[];
}) {
  const value = node.fontWeight;
  const weightVars = Object.entries(variablesOf(doc)).filter(([, v]) => v.type === "fontWeight");
  const bound = bindingsOf(node).fontWeight;
  const options = WEIGHTS.filter(([w]) => weights.includes(Number(w)));
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Font weight"
          className={pickerTrigger}
          data-bound={bound ? "fontWeight" : undefined}
        >
          {bound ? (
            <VariableChip
              name={bound}
              missing={!weightVars.some(([name]) => name === bound)}
              className="ml-0.75"
            />
          ) : (
            <>
              <span className="truncate">{weightName(value)}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="left"
        align="start"
        sideOffset={12}
        className="w-48"
        id="font-weight-picker"
      >
        <div className="flex h-7 items-center gap-2 px-2 text-xs text-foreground-3">
          <Diamond className="size-3.5" aria-hidden />
          Apply variable
        </div>
        {weightVars.map(([name, v]) => (
          <DropdownMenuItem
            key={name}
            onSelect={() => bindVariable(doc, selection, "fontWeight", name)}
            className="justify-between"
          >
            <span className="truncate">{name}</span>
            <span className="text-muted-foreground">{weightName(String(v.value))}</span>
            {bound === name ? <Check className="size-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        {bound ? (
          <DropdownMenuItem onSelect={() => bindVariable(doc, selection, "fontWeight", null)}>
            Detach variable
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {options.map(([weight, label]) => (
          <DropdownMenuItem
            key={weight}
            data-weight={weight}
            onSelect={() => setField(selection, node, "fontWeight", weight)}
            className="justify-between"
          >
            {label}
            {!bound && String(value) === weight ? <Check className="size-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ALIGN = [
  { value: "left", label: "Align left", icon: TextAlignStart },
  { value: "center", label: "Align center", icon: TextAlignCenter },
  { value: "right", label: "Align right", icon: TextAlignEnd },
  { value: "justify", label: "Justify", icon: TextAlignJustify },
];
const ALIGN_VERTICAL = [
  { value: "top", label: "Align top", icon: TextAlignTopIcon },
  { value: "center", label: "Align middle", icon: TextAlignMiddleIcon },
  { value: "bottom", label: "Align bottom", icon: TextAlignBottomIcon },
];

/** Typography fields beyond the base model (all optional; absent = the canvas default). */
type TypeNode = Omit<Node, "lineHeight"> & {
  lineHeight: number | "auto";
  textAlignVertical?: "top" | "center" | "bottom";
  textTransform?: string;
  textDecoration?: string;
  textWrap?: string;
  whiteSpace?: string;
  wordBreak?: "normal" | "break-all";
  truncate?: boolean;
  noWrap?: boolean;
  textIndent?: number;
  fontSmoothing?: "antialiased" | "subpixel-antialiased";
};

/** Bindings of a node without `key` (typing a value detaches the property from its variable). */
function withoutBinding(node: Node, key: string) {
  const rest = Object.fromEntries(Object.entries(bindingsOf(node)).filter(([k]) => k !== key));
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * Write one typography field to the text layers of the selection (one undo step). `undefined` / "" clears the
 * field back to the canvas default, so untouched documents never gain new keys.
 */
function setTypeField(selection: string[], key: string, value: unknown) {
  const next = value === "" ? undefined : value;
  patchNodes(selection, (n) => (n.type === "text" ? { [key]: next } : {}));
}

export function TypographySection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const text = node as unknown as TypeNode;
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const [catalog, setCatalog] = useState<FontEntry[]>([]);
  const [installed, setInstalled] = useState<FontEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void loadCatalog().then((fonts) => live && setCatalog(fonts));
    return () => {
      live = false;
    };
  }, []);
  // Installed fonts need a user gesture: requested when the family picker opens.
  const requestLocal = () => void loadLocalFonts().then(setInstalled);
  const fonts = useMemo(() => [...catalog, ...installed], [catalog, installed]);
  const weights = weightsFor(node.fontFamily, fonts);
  const autoLeading = text.lineHeight === "auto";
  // Line height: a ratio, or "Auto" (empty / "auto") for the font's own line height (CSS `normal`).
  const commitLineHeight = (raw: string) => {
    if (/^\s*(auto)?\s*$/i.test(raw)) {
      patchNodes(selection, (n) =>
        n.type === "text" ? { lineHeight: "auto", bindings: withoutBinding(n, "lineHeight") } : {},
      );
      return null;
    }
    return setField(selection, node, "lineHeight", raw);
  };
  return (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      {/* The settings popover opens beside the inspector, anchored to the whole section (Wonder A10). */}
      <PopoverAnchor asChild>
        <div>
          <Section
            id="typography-section"
            title="Typography"
            tools={
              <PopoverTrigger asChild>
                <IconButton
                  id="type-settings-toggle"
                  className="size-7"
                  icon={SlidersIcon}
                  label="Type settings"
                  active={settingsOpen}
                />
              </PopoverTrigger>
            }
          >
            <FontFamilyPicker
              doc={doc}
              node={node}
              selection={selection}
              fonts={fonts}
              onLocalFonts={requestLocal}
            />
            <div className="grid grid-cols-2 gap-2">
              <FontWeightPicker doc={doc} node={node} selection={selection} weights={weights} />
              <BindableField
                doc={doc}
                node={node}
                selection={selection}
                field="fontSize"
                label="Font size"
                prefix={<IconAffix icon={FontSizeIcon} />}
              >
                {(suffix) => (
                  <Field
                    name="fontSize"
                    label="Font size"
                    numeric
                    value={fmt(node.fontSize)}
                    onCommit={set("fontSize")}
                    prefix={<IconAffix icon={FontSizeIcon} />}
                    suffix={<>px{suffix}</>}
                  />
                )}
              </BindableField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Caption label="Line height">
                <BindableField
                  doc={doc}
                  node={node}
                  selection={selection}
                  field="lineHeight"
                  label="Line height"
                  prefix={<IconAffix icon={LineHeightIcon} />}
                >
                  {(suffix) => (
                    <Field
                      name="lineHeight"
                      label="Line height"
                      numeric
                      step={0.05}
                      value={autoLeading ? "Auto" : fmt(text.lineHeight)}
                      placeholder="Auto"
                      onCommit={commitLineHeight}
                      prefix={<IconAffix icon={LineHeightIcon} />}
                      suffix={suffix}
                    />
                  )}
                </BindableField>
              </Caption>
              <Caption label="Letter spacing">
                <BindableField
                  doc={doc}
                  node={node}
                  selection={selection}
                  field="letterSpacing"
                  label="Letter spacing"
                  prefix={<Affix className="-mx-px w-3.5 text-2xs">|A|</Affix>}
                >
                  {(suffix) => (
                    <Field
                      name="letterSpacing"
                      label="Letter spacing"
                      numeric
                      step={0.1}
                      value={fmt(node.letterSpacing)}
                      onCommit={set("letterSpacing")}
                      prefix={<Affix className="-mx-px w-3.5 text-2xs">|A|</Affix>}
                      suffix={<>px{suffix}</>}
                    />
                  )}
                </BindableField>
              </Caption>
            </div>
            <Caption label="Alignment">
              <div className="grid grid-cols-2 gap-2">
                <Segmented
                  label="Text alignment"
                  value={node.textAlign}
                  onChange={set("textAlign")}
                  items={ALIGN}
                />
                <Segmented
                  label="Vertical text alignment"
                  value={text.textAlignVertical ?? "top"}
                  onChange={(v) =>
                    setTypeField(selection, "textAlignVertical", v === "top" ? "" : v)
                  }
                  items={ALIGN_VERTICAL}
                />
              </div>
            </Caption>
          </Section>
        </div>
      </PopoverAnchor>
      <PopoverContent
        id="type-settings"
        side="left"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        aria-label="Type settings"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <TypeSettings node={text} selection={selection} onClose={() => setSettingsOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

const CASES = [
  { value: "", label: "No case", content: <Minus className="size-4" aria-hidden /> },
  { value: "uppercase", label: "Uppercase", content: "AG" },
  { value: "lowercase", label: "Lowercase", content: "ag" },
  { value: "capitalize", label: "Capitalize", content: "Ag" },
];
const DECORATIONS = [
  { value: "", label: "No decoration", content: <Minus className="size-4" aria-hidden /> },
  { value: "underline", label: "Underline", content: <Underline className="size-4" aria-hidden /> },
  {
    value: "line-through",
    label: "Strikethrough",
    content: <Strikethrough className="size-4" aria-hidden />,
  },
];
const WRAPS = [
  { value: "", label: "Auto" },
  { value: "balance", label: "Balance" },
  { value: "pretty", label: "Pretty" },
  { value: "nowrap", label: "No wrap" },
];
// "Normal" is the canvas default: the text keeps the line breaks and spaces it was typed with (pre-wrap).
const WHITESPACES = [
  { value: "", label: "Normal" },
  { value: "normal", label: "Collapse" },
  { value: "nowrap", label: "No wrap" },
  { value: "pre", label: "Preserve" },
  { value: "pre-line", label: "Pre-line" },
  { value: "break-spaces", label: "Break spaces" },
];
const SMOOTHINGS = [
  { value: "", label: "Default" },
  { value: "antialiased", label: "Antialiased" },
  { value: "subpixel-antialiased", label: "Subpixel" },
];

const PREVIEW =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.";

/** Type settings popover (Wonder A10): preview, case, wrap, whitespace, truncation, word break, indent, smoothing, decoration. */
function TypeSettings({
  node,
  selection,
  onClose,
}: {
  node: TypeNode;
  selection: string[];
  onClose: () => void;
}) {
  const put = (key: string) => (value: string) => setTypeField(selection, key, value);
  const whiteSpace = node.whiteSpace ?? (node.noWrap ? "pre" : "");
  return (
    <div className="flex flex-col gap-2">
      <div className="-mt-1 flex h-6 items-center justify-between">
        <h4 className="text-xs text-foreground">Type settings</h4>
        <IconButton icon={X} label="Close type settings" onClick={onClose} />
      </div>
      <TypePreview node={node} />
      <Caption label="Case">
        <TextSegmented
          name="textTransform"
          label="Case"
          value={node.textTransform && node.textTransform !== "none" ? node.textTransform : ""}
          onChange={put("textTransform")}
          items={CASES}
        />
      </Caption>
      <div className="grid grid-cols-2 gap-2">
        <Caption label="Wrap">
          <NativeSelect
            name="textWrap"
            label="Wrap"
            value={WRAPS.some((o) => o.value === node.textWrap) ? (node.textWrap ?? "") : ""}
            options={WRAPS}
            onChange={put("textWrap")}
          />
        </Caption>
        <Caption label="Whitespace">
          <NativeSelect
            name="whiteSpace"
            label="Whitespace"
            value={whiteSpace}
            options={WHITESPACES}
            onChange={(value) =>
              patchNodes(selection, (n) =>
                n.type === "text" ? { whiteSpace: value || undefined, noWrap: undefined } : {},
              )
            }
          />
        </Caption>
        <Caption label="Truncation">
          <TextSegmented
            name="truncate"
            label="Truncation"
            value={node.truncate ? "on" : "off"}
            onChange={(value) => setTypeField(selection, "truncate", value === "on" || undefined)}
            items={[
              { value: "off", label: "Truncation off", content: "Off" },
              { value: "on", label: "Truncation on", content: "On" },
            ]}
          />
        </Caption>
        <Caption label="Word Break">
          <TextSegmented
            name="wordBreak"
            label="Word break"
            value={
              node.wordBreak === "normal" ? "off" : node.wordBreak === "break-all" ? "all" : "word"
            }
            onChange={(value) =>
              setTypeField(
                selection,
                "wordBreak",
                value === "off" ? "normal" : value === "all" ? "break-all" : "",
              )
            }
            items={[
              { value: "off", label: "Word break off", content: "Off" },
              { value: "all", label: "Break all", content: "All" },
              { value: "word", label: "Break words", content: "Word" },
            ]}
          />
        </Caption>
        <Caption label="Indent">
          <Field
            name="textIndent"
            label="Indent"
            numeric
            value={fmt(node.textIndent ?? 0)}
            prefix={<IconAffix icon={TextIndentIcon} />}
            suffix="px"
            onCommit={(raw) => {
              const v = Number(raw.trim());
              if (raw.trim() === "" || !Number.isFinite(v)) {
                notify("Enter a number.");
                return "Enter a number.";
              }
              setTypeField(selection, "textIndent", Math.max(-10000, Math.min(10000, v)) || "");
              return null;
            }}
          />
        </Caption>
        <Caption label="Smoothing">
          <NativeSelect
            name="fontSmoothing"
            label="Smoothing"
            value={node.fontSmoothing ?? ""}
            options={SMOOTHINGS}
            onChange={put("fontSmoothing")}
          />
        </Caption>
        <Caption label="Decoration">
          <TextSegmented
            name="textDecoration"
            label="Decoration"
            value={
              DECORATIONS.some((d) => d.value === node.textDecoration)
                ? (node.textDecoration ?? "")
                : ""
            }
            onChange={put("textDecoration")}
            items={DECORATIONS}
          />
        </Caption>
      </div>
    </div>
  );
}

/** Sample text styled with the layer's family, weight and type settings (CSS set through the DOM, no style props). */
function TypePreview({ node }: { node: TypeNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = el.style;
    s.fontFamily = `"${String(node.fontFamily).replace(/"/g, "")}", var(--font-sans)`;
    s.fontWeight = textOf(node.fontWeight || "400");
    s.textTransform = node.textTransform || "";
    s.textDecorationLine = node.textDecoration || "";
    s.textIndent = node.textIndent ? `${node.textIndent}px` : "";
    s.whiteSpace = node.truncate ? "nowrap" : node.whiteSpace || (node.noWrap ? "pre" : "");
    s.textOverflow = node.truncate ? "ellipsis" : "";
    s.overflowWrap = node.wordBreak === "normal" ? "normal" : "anywhere";
    s.wordBreak = node.wordBreak === "break-all" ? "break-all" : "";
    s.setProperty("text-wrap", node.textWrap || "");
    s.setProperty(
      "-webkit-font-smoothing",
      node.fontSmoothing === "antialiased" ? "antialiased" : node.fontSmoothing ? "auto" : "",
    );
  }, [
    node.fontFamily,
    node.fontWeight,
    node.textTransform,
    node.textDecoration,
    node.textIndent,
    node.whiteSpace,
    node.noWrap,
    node.truncate,
    node.wordBreak,
    node.textWrap,
    node.fontSmoothing,
  ]);
  return (
    <div className="h-28 overflow-hidden rounded-lg border border-border bg-background px-3 py-2.5">
      <p ref={ref} id="type-settings-preview" className="overflow-hidden text-sm/5 text-foreground">
        {PREVIEW}
      </p>
    </div>
  );
}

/** Segmented control with text or icon segments (Wonder's Type settings rows), on the Radix toggle group. */
function TextSegmented({
  name,
  label,
  value,
  onChange,
  items,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string; content: ReactNode }[];
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label={label}
      data-name={name}
      // Radix treats "" as "nothing pressed", so the empty (default) value travels as "none".
      value={value || "none"}
      onValueChange={(next) => {
        if (next) onChange(next === "none" ? "" : next);
      }}
      className="flex h-6 w-full items-stretch rounded-md bg-muted"
    >
      {items.map((item) => (
        <ToggleGroupPrimitive.Item
          key={item.value || "none"}
          value={item.value || "none"}
          aria-label={item.label}
          title={item.label}
          className="flex min-w-0 flex-1 items-center justify-center rounded-md text-xs text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground"
        >
          {item.content}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
