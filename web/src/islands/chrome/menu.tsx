// Menu primitives for the chrome island (Wonder menu look: 19-workspace-layout-menu.png).
// Local wrappers instead of the shared dropdown-menu: no close animation, so legacy ids rendered inside a menu
// unmount immediately when it closes (their hidden proxies take the ids back in the same frame).
import type { ComponentProps, ReactNode } from "react";
import { DropdownMenu as Menu } from "radix-ui";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";

export const MenuRoot = Menu.Root;
export const MenuTrigger = Menu.Trigger;

export function MenuContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal container={portalContainer()}>
      <Menu.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 flex max-h-(--radix-dropdown-menu-content-available-height) flex-col overflow-y-auto rounded-2xl border border-menu-edge bg-background text-xs text-foreground shadow-menu outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function MenuGroup({ className, ...props }: ComponentProps<typeof Menu.Group>) {
  return <Menu.Group className={cn("flex flex-col p-1", className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn("flex h-6.25 items-center px-1.5 text-muted-foreground", className)}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator className={cn("h-px shrink-0 bg-toolbar-divider", className)} {...props} />
  );
}

const itemClass =
  "relative flex h-6.25 shrink-0 cursor-default items-center gap-2 rounded-md px-1.5 py-0 text-xs text-foreground outline-none select-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-foreground-3";

export function MenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(itemClass, className)} {...props} />;
}

/** Item whose text node is data for legacy code/tests (e.g. `#zoom-reset` = "134%"); the visible label is drawn by
 * ::before/::after in chrome.css, so the element's own text is zero-sized. */
export function MenuPseudoLabelItem(props: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className="relative flex h-6.25 shrink-0 cursor-default items-center gap-2 rounded-md px-1.5 py-0 text-0 text-foreground outline-none select-none data-[highlighted]:bg-accent"
      {...props}
    />
  );
}

export function MenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(itemClass, className)} {...props}>
      {children}
    </Menu.CheckboxItem>
  );
}

export const MenuItemIndicator = Menu.ItemIndicator;

/** Keyboard shortcut chips ("⌥" "1"), as in Wonder's layout menu. */
export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn("ml-auto flex items-center gap-0.5", className)}>
      {keys.map((key) => (
        <kbd
          key={key}
          className="flex h-4.5 min-w-4.5 items-center justify-center rounded-sm bg-muted px-1 font-sans text-2xs text-foreground-3"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** Plain shortcut text (app/zoom menus). */
export function Shortcut({ children }: { children: ReactNode }) {
  return <span className="ml-auto pl-4 text-xs text-muted-foreground">{children}</span>;
}
