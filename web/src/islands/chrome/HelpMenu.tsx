// `?` help menu at the bottom-left of the canvas (Wonder T5-help): Docs ↗, Keyboard shortcuts, Restart onboarding,
// Give feedback, Contact us ↗, Discord community ↗, Export diagnostic logs | What's new. Items without a Verynize
// mechanism use placeholder URLs for now (see help-links.ts). What's new lists placeholder entries (title over a
// date, 44px rows like Wonder's "Wonder Capture / August 18") before View all.
// Wonder T5-help, measured: the section has no icons; label 12px ink from x+10 of the menu; entry titles and
// "View all" 13px, dates 12px secondary grey, all from x+12; titles' cap top 11px into the 44px row and baselines
// 16.5px apart (13px/20px title over 12px/12px date, 1px apart, centred); "View all" is an ordinary 29px row.
import { useState, type ComponentType } from "react";
import {
  ArrowUpRight,
  AtSign,
  BookText,
  Download,
  Keyboard,
  MessageSquare,
  MessagesSquare,
  Undo2,
} from "lucide-react";
import { HELP_LINKS, WHATS_NEW, openExternal } from "./help-links";
import {
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "./menu";
import { setPanelOpen } from "./shortcuts";
import { Tip } from "./tip";

type Item = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  external?: boolean;
  /** Null when Verynize has no target for it yet (item disabled). */
  action: (() => void) | null;
};

const link = (url: string | null) => (url ? () => openExternal(url) : null);

const ITEMS: Item[] = [
  { id: "help-docs", label: "Docs", icon: BookText, external: true, action: link(HELP_LINKS.docs) },
  {
    id: "help-shortcuts",
    label: "Keyboard shortcuts",
    icon: Keyboard,
    action: () => setPanelOpen("shortcuts", true),
  },
  {
    id: "help-onboarding",
    label: "Restart onboarding",
    icon: Undo2,
    action: () => window.dispatchEvent(new Event("bd:open-onboarding")),
  },
  {
    id: "help-feedback",
    label: "Give feedback",
    icon: MessageSquare,
    action: link(HELP_LINKS.feedback),
  },
  {
    id: "help-contact",
    label: "Contact us",
    icon: AtSign,
    external: true,
    action: link(HELP_LINKS.contact),
  },
  {
    id: "help-discord",
    label: "Discord community",
    icon: MessagesSquare,
    external: true,
    action: link(HELP_LINKS.discord),
  },
  {
    id: "help-diagnostics",
    label: "Export diagnostic logs",
    icon: Download,
    action: link(HELP_LINKS.diagnostics),
  },
];

// Wonder R6-help-menu: 180px menu, 13px text starting 34px in (12px icon, 9px gap), cut with an ellipsis at 112px
// beside the ↗ icon ("Discord commu…") and at 128px without it ("Export diagnostic l…").
const row = "h-7.25 gap-2.25 px-2 text-sm";

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const whatsNew = link(HELP_LINKS.whatsNew);
  return (
    <MenuRoot open={open} onOpenChange={setOpen} modal={false}>
      <Tip label="Help" side="right">
        <MenuTrigger asChild>
          <button
            type="button"
            id="bd-canvas-help"
            aria-label="Help"
            className="absolute bottom-1.75 left-1.75 z-30 flex size-6.5 items-center justify-center rounded-full border border-edge bg-help text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:text-foreground"
          >
            ?
          </button>
        </MenuTrigger>
      </Tip>
      <MenuContent
        id="bd-help-menu"
        aria-label="Help"
        side="top"
        align="start"
        sideOffset={8}
        className="w-45"
      >
        <MenuGroup>
          {ITEMS.map(({ id, label, icon: Icon, external, action }) => (
            <MenuItem
              key={id}
              id={id}
              className={row}
              disabled={!action}
              onSelect={() => action?.()}
            >
              <Icon className="size-3" />
              <span
                data-help-label=""
                className={external ? "max-w-28 truncate" : "max-w-32 truncate"}
              >
                {label}
              </span>
              {external ? <ArrowUpRight className="ml-auto size-3 text-muted-foreground" /> : null}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuLabel className="px-1.25 text-menu-label">What&apos;s new</MenuLabel>
          {WHATS_NEW.map(({ id, title, date, url }) => (
            <MenuItem
              key={id}
              data-whats-new={id}
              className="h-11 gap-2.5 px-1.75"
              onSelect={() => openExternal(url)}
            >
              <span className="flex min-w-0 flex-col gap-px">
                <span data-whats-new-title="" className="truncate text-sm leading-5">
                  {title}
                </span>
                <span
                  data-whats-new-date=""
                  className="truncate text-xs leading-3 text-foreground-3"
                >
                  {date}
                </span>
              </span>
              <ArrowUpRight className="ml-auto size-3 text-muted-foreground" />
            </MenuItem>
          ))}
          <MenuItem
            id="help-whats-new"
            className="h-7.25 gap-2.25 px-1.75 text-sm"
            disabled={!whatsNew}
            onSelect={() => whatsNew?.()}
          >
            <span className="truncate">View all</span>
            <ArrowUpRight className="ml-auto size-3 text-muted-foreground" />
          </MenuItem>
        </MenuGroup>
      </MenuContent>
    </MenuRoot>
  );
}
