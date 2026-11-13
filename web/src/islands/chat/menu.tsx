/* oxlint-disable shadcn/no-restyle -- Wonder's chat menus (13px text, 24px rows, background surface, right-hand
   checks) differ from the editor-density shared DropdownMenu; this file is the one place that look is applied. */
// Wonder chat menus (29–35): thin wrappers over the shared shadcn DropdownMenu (portal, animation, keyboard and ARIA
// come from it); only the chat density is applied here. Call sites pass layout classes (width, alignment) only.
import type { ComponentProps } from "react";
import { DropdownMenu as Menu } from "radix-ui";
import { CheckIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const ChatMenu = DropdownMenu;
export const ChatMenuTrigger = DropdownMenuTrigger;
export const ChatMenuSub = DropdownMenuSub;
export const ChatMenuGroup = DropdownMenuGroup;
export const ChatMenuRadioGroup = DropdownMenuRadioGroup;
export const ChatMenuSeparator = DropdownMenuSeparator;

const surface = "min-w-0 bg-background p-1 text-sm text-foreground-2";

export function ChatMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(surface, className)}
      {...props}
    />
  );
}

export function ChatMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuSubContent>) {
  // Portalled so the parent's scroll box and open animation never clip or offset the submenu.
  return (
    <DropdownMenuPortal>
      <DropdownMenuSubContent
        sideOffset={6}
        alignOffset={-5}
        collisionPadding={8}
        className={cn(
          surface,
          "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
          className,
        )}
        {...props}
      />
    </DropdownMenuPortal>
  );
}

const row =
  "h-6 text-sm focus:bg-muted focus:text-foreground-2 data-[highlighted]:bg-muted [&_svg:not([class*='text-'])]:text-muted-foreground";
/** Check / radio rows: the shadcn left indicator is hidden and the check is drawn on the right, as in Wonder. */
const indicatorRow = cn(row, "pl-2 [&>span:first-child]:hidden");

function RightCheck() {
  return (
    <Menu.ItemIndicator className="ml-auto flex self-center pl-2">
      <CheckIcon className="size-3.5 text-foreground-2" />
    </Menu.ItemIndicator>
  );
}

export function ChatMenuItem({
  className,
  checked,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & { checked?: boolean }) {
  return (
    <DropdownMenuItem className={cn(row, className)} {...props}>
      {children}
      {checked && <CheckIcon className="ml-auto size-3.5 text-foreground-2" />}
    </DropdownMenuItem>
  );
}

export function ChatMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuRadioItem>) {
  return (
    <DropdownMenuRadioItem className={cn(indicatorRow, className)} {...props}>
      {children}
      <RightCheck />
    </DropdownMenuRadioItem>
  );
}

/** Two-line radio row (31): icon, title and a 12px hint; the check sits on the right, vertically centred. */
export function ChatMenuOptionItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuRadioItem>) {
  return (
    <DropdownMenuRadioItem
      className={cn(indicatorRow, "h-auto items-start py-1.5", className)}
      {...props}
    >
      {children}
      <RightCheck />
    </DropdownMenuRadioItem>
  );
}

export function ChatMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuCheckboxItem>) {
  return (
    <DropdownMenuCheckboxItem className={cn(indicatorRow, className)} {...props}>
      {children}
      <RightCheck />
    </DropdownMenuCheckboxItem>
  );
}

export function ChatMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuSubTrigger>) {
  return (
    <DropdownMenuSubTrigger
      className={cn(
        row,
        "data-[state=open]:bg-muted data-[state=open]:text-foreground-2 [&>svg:last-child]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </DropdownMenuSubTrigger>
  );
}

export function ChatMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuLabel>) {
  return (
    <DropdownMenuLabel
      className={cn(
        "flex h-6 items-center py-0 text-sm font-normal text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Wrapping explanatory text inside a menu (the rewind confirmation). */
export function ChatMenuNote({ className, ...props }: ComponentProps<typeof DropdownMenuLabel>) {
  return (
    <DropdownMenuLabel
      className={cn("py-1 text-sm leading-4.5 font-normal text-muted-foreground", className)}
      {...props}
    />
  );
}
