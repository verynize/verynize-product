// Small building blocks shared by the sidebar sections.
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonProps = ComponentProps<"button"> & { label: string; tooltip?: boolean };

/** 24px icon-only button with a tooltip. */
export function IconButton({
  label,
  tooltip = true,
  className,
  children,
  ref,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-transparent text-foreground-3 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Wraps one control in the app tooltip (instead of a native `title`). */
export function Hint({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Collapsible section header ("Pages", "Layers"): 36px, chevron + title on the left, actions on the right. */
export function SectionHeader({
  title,
  open,
  onToggle,
  controls,
  className,
  children,
}: {
  title: string;
  className?: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex h-9 shrink-0 items-center gap-2 pr-3 pl-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className="flex h-6 min-w-0 flex-1 items-center gap-2.25 rounded-md bg-transparent pl-0.25 text-left text-xs text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground-3"
      >
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform duration-150", !open && "-rotate-90")}
        />
        <span className="truncate">{title}</span>
      </button>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Inline text field used for renaming; commits on Enter/blur, cancels on Escape. */
export function InlineRename({
  value,
  label,
  onCommit,
  onDone,
  className,
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  onDone: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = draft.trim();
    if (commit && next && next !== value) onCommit(next);
    onDone();
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      className={cn(
        "block h-6 w-full min-w-0 rounded-sm bg-input px-1.5 text-xs text-foreground outline outline-1 outline-ring",
        className,
      )}
    />
  );
}
