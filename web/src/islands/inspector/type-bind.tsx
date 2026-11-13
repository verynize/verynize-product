// Type-to-bind (properties audit G1 / B5): typing a variable name into a bindable numeric field opens a list of the
// compatible variables directly under the field. Wonder evidence: design/wonder/properties-audit/wonder/G1-*.png.
// - W/H and the main gap: the list opens once the typed text contains a letter and some variable name contains it
//   (Wonder matched "imension" to "dimension-1"); nothing is highlighted until ↓/↑ (G1-gap vs G1-width-suggestions).
// - An empty Min/Max W/H row shows every compatible variable as soon as it is focused (G1-min-width, G1-max-width).
// - ↓/↑ move, Enter binds the highlighted variable through the same path as the diamond menu (`bindVariable`), so the
//   field turns into the bound chip (G1-width-enter). Escape closes the list and keeps the typed text and focus.
// Geometry: the list starts 4px under the field, as wide as the field, 4px padding, 24px rows (32px for one row),
// panel fill with a 0.5px edge and 10px radius; the name truncates with an ellipsis and the value sits on the right.
// The field itself is untouched: the wrapper listens in the capture phase and only swallows keys while the list is open.
import {
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { portalContainer, type DesignDocument } from "@/lib/bridge";
import { BINDABLE, bindVariable, valueLabel, variablesOf } from "./vars";

export type TypeBindMode = "typing" | "empty";

/** Compatible variables whose name contains `text`; every compatible one for an empty `empty`-mode field. */
export function typeBindMatches(
  doc: DesignDocument,
  field: string,
  text: string,
  mode: TypeBindMode,
) {
  const types = BINDABLE[field] ?? [];
  const all = Object.entries(variablesOf(doc)).filter(([, v]) => types.includes(v.type));
  const query = text.trim().toLowerCase();
  if (!query) return mode === "empty" ? all : [];
  // Numbers, units and expressions ("24", "50%", "100% - 24px") stay plain values unless a name matches them.
  if (!/[a-z]/i.test(query)) return [];
  return all.filter(([name]) => name.toLowerCase().includes(query));
}

export function TypeBind({
  doc,
  selection,
  field,
  mode,
  children,
}: {
  doc: DesignDocument;
  selection: string[];
  field: string;
  mode: TypeBindMode;
  children: ReactNode;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const shell = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const items = query === null ? [] : typeBindMatches(doc, field, query, mode);
  const open = items.length > 0;
  // Read by the key handler: a synthetic Escape sent while binding must reach the field, not this list.
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });

  const show = (target: EventTarget) => {
    if (!(target instanceof HTMLInputElement)) return;
    input.current = target;
    shell.current = target.closest<HTMLElement>("[data-field-shell]") ?? target;
    setQuery(target.value);
    setActive(-1);
  };
  const close = () => {
    setQuery(null);
    setActive(-1);
  };
  const pick = (name: string) => {
    openRef.current = false;
    close();
    // Drop the typed text first (the field's own Escape: clear the draft, blur), so the blur never commits the name
    // as a value; then bind, which swaps the field for the variable chip.
    input.current?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    bindVariable(doc, selection, field, name);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!openRef.current || event.target !== input.current) return;
    const swallow = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      swallow();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) =>
        i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length,
      );
    } else if (event.key === "Enter" && active >= 0 && items[active]) {
      swallow();
      pick(items[active][0]);
    } else if (event.key === "Escape") {
      swallow();
      close();
    } else if (event.key === "Enter" || event.key === "Tab") close();
  };

  return (
    <div
      className="contents"
      data-type-bind-field={field}
      onInputCapture={(event: FormEvent<HTMLElement>) => show(event.target)}
      onFocusCapture={(event: FocusEvent<HTMLElement>) => {
        if (mode === "empty" && event.target instanceof HTMLInputElement && !event.target.value)
          show(event.target);
      }}
      onBlurCapture={(event: FocusEvent<HTMLElement>) => {
        // "Add min width" focuses the new row while its menu is still fading out; the list then opens under the
        // pointer, the menu item sees a pointer leave and pulls focus into the closing menu. Take it back.
        const to = event.relatedTarget;
        if (
          open &&
          event.target === input.current &&
          to instanceof HTMLElement &&
          to.closest("[role=menu][data-state=closed]")
        ) {
          const el = input.current;
          requestAnimationFrame(() => el.focus());
          return;
        }
        close();
      }}
      onKeyDownCapture={onKeyDown}
    >
      {children}
      <PopoverPrimitive.Root open={open}>
        <PopoverPrimitive.Anchor virtualRef={shell} />
        <PopoverPrimitive.Portal container={portalContainer()}>
          <PopoverPrimitive.Content
            side="bottom"
            align="start"
            sideOffset={4}
            role="listbox"
            aria-label="Variables"
            data-type-bind={field}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            // Escape is handled on the field (close, keep typing); a press on the field itself keeps the list.
            onEscapeKeyDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              if (shell.current?.contains(event.target as globalThis.Node)) event.preventDefault();
              else close();
            }}
            className="z-50 flex max-h-60 flex-col overflow-y-auto rounded-xl bg-background p-1 text-xs text-foreground shadow-type-bind outline-hidden"
          >
            {items.map(([name, variable], index) => (
              <div
                key={name}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                data-variable={name}
                data-active={index === active || undefined}
                title={name}
                className="flex h-6 shrink-0 cursor-default items-center gap-2 rounded-md px-1.5 data-active:bg-input"
                // Keep the caret in the field while choosing with the pointer.
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => setActive(index)}
                onClick={() => pick(name)}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 text-muted-foreground">{valueLabel(variable)}</span>
              </div>
            ))}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
