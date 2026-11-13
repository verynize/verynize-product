/* oxlint-disable shadcn/no-restyle, shadcn/require-static-classes -- the chat runs at Wonder's chat density (14px chips,
   13px card actions, 20px message actions; 29–37, 51), which the editor-density shared Button has no size for. This
   file is the one place that density is applied: call sites use these presets and pass layout classes only, plus an
   optional `hook` (DOM hook class from ./hooks that tests and chat.css select on, not a style). */
// Chat-density presets of the shared shadcn Button: same variants (colours, focus ring, disabled state), chat sizes.
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = Omit<ComponentProps<typeof Button>, "size"> & { hook?: string };

/** 24px, 14px text: composer chips (model, access). */
export function ChatChipButton({ className, hook, variant = "ghost", ...props }: ButtonProps) {
  return (
    <Button
      variant={variant}
      size="xs"
      className={cn(
        hook,
        "gap-1.5 px-1.5 text-base leading-5.25 text-chat-chip hover:text-chat-chip data-[state=open]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 26px, 14px text: dock header controls (chat switcher, Changes, Start preview). `segment` squares the corners for a
 * part of a split button (the group draws the rounded border); `"icon"` is its narrow chevron part.
 */
export function ChatHeaderButton({
  className,
  hook,
  variant = "ghost",
  segment,
  ...props
}: ButtonProps & { segment?: "text" | "icon" }) {
  return (
    <Button
      variant={variant}
      className={cn(
        hook,
        "h-6.5 gap-2 px-2 text-base leading-5.25 text-foreground-2 hover:text-foreground-2 data-[state=open]:bg-muted",
        segment && "rounded-none",
        segment === "icon" && "w-5.5 px-0 has-[>svg]:px-0",
        className,
      )}
      {...props}
    />
  );
}

/** 24px, 13px text: card actions (Allow / Deny, Submit, edit Cancel / Send). Ghost: quiet row action ("Send now"). */
export function ChatActionButton({ className, hook, variant = "default", ...props }: ButtonProps) {
  return (
    <Button
      variant={variant}
      size="sm"
      className={cn(
        hook,
        "gap-1 px-2.5 text-sm",
        variant === "outline" && "text-foreground-2",
        variant === "ghost" &&
          "px-1.5 text-muted-foreground hover:text-foreground-2 focus-visible:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Ghost icon button: `md` 28px (header), `sm` 24px (queue rows, dialogs), `xs` 20px (message actions, chip remove). */
export function ChatIconButton({
  className,
  hook,
  size = "md",
  ...props
}: Omit<ButtonProps, "variant"> & { size?: "md" | "sm" | "xs" }) {
  return (
    <Button
      variant="ghost"
      size={size === "md" ? "icon" : size === "sm" ? "icon-sm" : "icon-xs"}
      className={cn(
        hook,
        "text-muted-foreground hover:text-foreground-2 focus-visible:bg-muted disabled:opacity-30 data-[state=open]:bg-muted data-[state=open]:text-foreground-2",
        size === "xs" &&
          "size-5 rounded-sm text-subtle-foreground hover:text-foreground focus-visible:text-foreground focus-visible:ring-0 data-[state=open]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Bordered pill on the card fill: artboard links under a reply (28px, 13px). */
export function ChatPillButton({ className, hook, ...props }: Omit<ButtonProps, "variant">) {
  return (
    <Button
      variant="outline"
      className={cn(
        hook,
        "rounded-lg border-card-border bg-card px-2.5 text-sm text-foreground-2",
        className,
      )}
      {...props}
    />
  );
}

/** Empty-state suggestion card: title + two-line prompt, content-sized. */
export function ChatSuggestionButton({ className, hook, ...props }: Omit<ButtonProps, "variant">) {
  return (
    <Button
      variant="outline"
      className={cn(
        hook,
        "h-auto flex-col items-start gap-0.5 rounded-xl border-card-border bg-card px-3 py-2 text-left whitespace-normal",
        className,
      )}
      {...props}
    />
  );
}

/** Answer option of a question card (radio / checkbox role set by the caller), highlighted when `selected`. */
export function ChatOptionButton({
  className,
  hook,
  selected,
  ...props
}: Omit<ButtonProps, "variant"> & { selected: boolean }) {
  return (
    <Button
      variant="outline"
      className={cn(
        hook,
        "h-auto min-h-8 items-start justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 whitespace-normal disabled:opacity-60",
        selected
          ? "border-ring bg-primary-tint text-foreground hover:bg-primary-tint"
          : "border-card-border bg-settings text-foreground-2",
        className,
      )}
      {...props}
    />
  );
}

/** Text row that selects or edits something: `text` 13px (queued message), `file` 12px (changed-file list). */
export function ChatRowButton({
  className,
  hook,
  density = "text",
  ...props
}: Omit<ButtonProps, "variant"> & { density?: "text" | "file" }) {
  return (
    <Button
      variant="ghost"
      className={cn(
        hook,
        "h-auto justify-start text-left hover:bg-transparent disabled:opacity-100",
        density === "text"
          ? "min-h-6 gap-1.5 px-1.5 text-sm leading-5 whitespace-normal text-foreground-2 hover:text-foreground-2 focus-visible:bg-muted"
          : "gap-2 self-stretch rounded-sm px-0 text-xs",
        className,
      )}
      {...props}
    />
  );
}
