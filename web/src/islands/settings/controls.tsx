// Settings building blocks measured from design/wonder/61, 70–79 (CSS px = screenshot px / 2).
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** 18px page title with an optional description and trailing action. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-10.5 px-4">
      <div className="flex min-h-6 items-center justify-between gap-4">
        <h1 className="text-xl font-medium text-foreground">{title}</h1>
        {action}
      </div>
      {description && (
        <p className="mt-2 max-w-150 text-sm leading-5 text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** A labelled group: 13px label (+ muted description) above a card. */
export function Section({
  title,
  description,
  action,
  children,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  const labelId = id ? `${id}-label` : undefined;
  return (
    <section aria-labelledby={labelId} className="flex flex-col">
      <div className="mb-4.5 flex items-end justify-between gap-4 px-4">
        <div className="min-w-0">
          <h2 id={labelId} className="text-sm font-medium text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** #222 card, #2e2e2e border, radius 12; rows inside get inset separators. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-card-border bg-card px-4 [&>*+*]:border-t [&>*+*]:border-divider",
        className,
      )}
      {...props}
    />
  );
}

/** 13px title + muted description on the left, control on the right. */
export function Row({
  title,
  description,
  children,
  icon,
  align = "center",
  htmlFor,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  align?: "center" | "start";
  htmlFor?: string;
  className?: string;
}) {
  const Title = htmlFor ? "label" : "div";
  return (
    <div
      className={cn(
        "flex min-h-16 gap-4 py-3.5",
        align === "center" ? "items-center" : "items-start",
        className,
      )}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <Title htmlFor={htmlFor} className="m-0 block text-sm text-foreground">
          {title}
        </Title>
        {description && (
          <div className="max-w-110 text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** 32px rounded icon tile used by agent / connection rows. */
export function IconTile({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-card-border bg-background text-foreground-3">
      {children}
      {badge && (
        <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center">
          {badge}
        </span>
      )}
    </span>
  );
}

/** Purple toggle (36 × 20). */
export function Toggle(props: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className="inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-accent p-0.5 transition-colors data-[state=checked]:bg-primary disabled:opacity-50"
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-foreground shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}

/** Compact native select (keeps keyboard + test `selectOption` support) with a Wonder chevron. */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        className="h-7 w-full appearance-none rounded-md bg-input pr-7 pl-2.5 text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-foreground-3"
      />
    </span>
  );
}

/** Field input: 28px, #1c1c1c fill with #2b2b2b border. */
export function TextField({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-7 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Text input that commits on blur / Enter (like a native `change`), so typing does not save every keystroke.
 * Uncontrolled; the latest committed value resets it when it changes elsewhere.
 */
export function CommitField({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<"input">, "value" | "defaultValue" | "onChange"> & {
  value: string | number;
  onCommit(value: string): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current)
      ref.current.value = String(value ?? "");
  }, [value]);
  return (
    <TextField
      ref={ref}
      defaultValue={String(value ?? "")}
      onBlur={(event) => {
        if (event.currentTarget.value !== String(value ?? "")) onCommit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(event.currentTarget.value);
      }}
      {...props}
    />
  );
}

/** Secondary 28px button (Set password / Show in Finder / Connect Figma). */
export function SettingsButton({
  className,
  variant = "secondary",
  ...props
}: ComponentProps<"button"> & { variant?: "secondary" | "primary" | "ghost" | "tint" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        variant === "secondary" && "bg-input text-foreground hover:bg-accent",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary-hover",
        variant === "ghost" &&
          "bg-transparent text-foreground-3 hover:bg-muted hover:text-foreground",
        variant === "tint" && "bg-primary-tint text-primary-text hover:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

/** 70 × 52 preview tile with a 2px purple ring 4px outside when selected, label below. */
export function ChoiceTile({
  selected,
  label,
  children,
  ...props
}: ComponentProps<"button"> & { selected: boolean; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className="group flex w-17.5 flex-col items-center gap-3.5 bg-transparent outline-none hover:bg-transparent"
      {...props}
    >
      <span
        className={cn(
          "relative block h-13 w-17.5 overflow-hidden rounded-lg outline-2 outline-offset-4 outline-transparent transition-colors group-hover:outline-edge group-focus-visible:outline-ring",
          selected && "outline-primary group-hover:outline-primary",
        )}
      >
        {children}
      </span>
      <span
        className={cn(
          "text-sm",
          selected ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}
