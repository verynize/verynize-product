// Presence in the inspector header (left of Share): overlapping avatars of the people in this file + a chevron that
// opens Wonder's "Multiplayer tools" popover (share-audit/wonder/SC1-tools.png, collab/14-owner-presence.png):
// "Find someone...", "Currently viewing (N)" with a Follow action per person, "You’re the only one here." when alone,
// this device's row "<name> (you)" with a status dot and three toggles (Hide cursors, Appear busy, Go invisible).
// The inspector header renders an empty `#presence-slot`; this portals into it wherever the header currently is
// (panel header or the collapsed-panel pill).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  BellIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  MousePointer2Icon,
  BellOffIcon,
} from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { usePresence, presence, type Person } from "./presence-engine";

const FILL: Record<number, string> = {
  1: "bg-peer-1",
  2: "bg-peer-2",
  3: "bg-peer-3",
  4: "bg-peer-4",
  5: "bg-peer-5",
  6: "bg-peer-6",
  7: "bg-peer-7",
  8: "bg-peer-8",
};
const RING: Record<number, string> = {
  1: "ring-peer-1",
  2: "ring-peer-2",
  3: "ring-peer-3",
  4: "ring-peer-4",
  5: "ring-peer-5",
  6: "ring-peer-6",
  7: "ring-peer-7",
  8: "ring-peer-8",
};

/** The slot the inspector header renders; it moves between the panel header and the collapsed pill. */
function usePresenceSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(() =>
    document.getElementById("presence-slot"),
  );
  useEffect(() => {
    const check = () => {
      const next = document.getElementById("presence-slot");
      setSlot((previous) => (previous === next ? previous : next));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, []);
  return slot;
}

function Avatar({
  person,
  status = false,
  ring = false,
}: {
  person: Person;
  status?: boolean;
  ring?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const letter = person.name.trim()[0]?.toUpperCase() || "?";
  return (
    <span
      data-avatar={person.id}
      className={cn(
        "relative flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium text-primary-foreground",
        FILL[person.colorIndex],
        ring && "ring-2",
        ring && RING[person.colorIndex],
      )}
    >
      {person.avatarUrl && !broken ? (
        <img
          src={person.avatarUrl}
          alt=""
          className="size-full rounded-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        letter
      )}
      {status ? (
        <span
          data-status={person.busy ? "busy" : "online"}
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-presence-popover",
            person.busy ? "bg-warning" : "bg-success",
          )}
        />
      ) : null}
    </span>
  );
}

function Toggle({
  id,
  label,
  pressed,
  onChange,
  children,
}: {
  id: string;
  label: string;
  pressed: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
        pressed && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PersonRow({ person, following }: { person: Person; following: boolean }) {
  const label = following ? `Stop following ${person.name}` : `Follow ${person.name}`;
  return (
    <button
      type="button"
      data-person={person.id}
      aria-label={label}
      aria-pressed={following}
      onClick={() => presence.follow(following ? null : person.id)}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-muted focus-visible:bg-muted",
        following && "bg-muted",
      )}
    >
      <Avatar person={person} status />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{person.name}</span>
      <span className="shrink-0 text-xs text-subtle-foreground">
        {following ? "Following" : person.busy ? "busy" : ""}
      </span>
    </button>
  );
}

function ToolsPopover() {
  const state = usePresence();
  const [query, setQuery] = useState("");
  const match = (person: Person) => person.name.toLowerCase().includes(query.trim().toLowerCase());
  const others = state.people.filter((person) => !person.self);
  const shown = others.filter(match);
  const self = state.self;
  return (
    <div id="presence-popover">
      <input
        id="presence-search"
        type="text"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find someone..."
        aria-label="Find someone"
        className="h-8 w-full border-0 border-b border-presence-rule bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
      />
      <div className="flex flex-col p-1">
        {others.length === 0 ? (
          <p className="m-0 px-2 py-3.5 text-center text-sm text-muted-foreground">
            You’re the only one here.
          </p>
        ) : (
          <>
            <p className="m-0 px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
              Currently viewing ({others.length})
            </p>
            {shown.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                following={state.following === person.id}
              />
            ))}
            {shown.length === 0 ? (
              <p className="m-0 px-2 py-2 text-xs text-subtle-foreground">
                No one matches “{query.trim()}”.
              </p>
            ) : null}
          </>
        )}
        {match(self) || !query.trim() ? (
          <div data-self className="flex h-9 items-center gap-2 px-2">
            <Avatar person={self} status />
            <span className="min-w-0 truncate text-sm text-foreground">{self.name}</span>
            <span className="shrink-0 text-sm text-subtle-foreground">(you)</span>
            <span className="flex-1" />
            <span className="flex shrink-0 items-center">
              <Toggle
                id="presence-hide-cursors"
                label="Hide cursors"
                pressed={state.prefs.hideCursors}
                onChange={(hideCursors) => presence.setPrefs({ hideCursors })}
              >
                <MousePointer2Icon className="size-3.5" />
              </Toggle>
              <Toggle
                id="presence-busy"
                label="Appear busy"
                pressed={state.prefs.busy}
                onChange={(busy) => presence.setPrefs({ busy })}
              >
                {state.prefs.busy ? (
                  <BellOffIcon className="size-3.5" />
                ) : (
                  <BellIcon className="size-3.5" />
                )}
              </Toggle>
              <Toggle
                id="presence-invisible"
                label="Go invisible"
                pressed={state.prefs.invisible}
                onChange={(invisible) => presence.setPrefs({ invisible })}
              >
                {state.prefs.invisible ? (
                  <EyeOffIcon className="size-3.5" />
                ) : (
                  <EyeIcon className="size-3.5" />
                )}
              </Toggle>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PresenceButton() {
  const state = usePresence();
  const [open, setOpen] = useState(false);
  const others = state.people.filter((person) => !person.self);
  // Others first (up to three), then this device; Wonder shows only its own avatar when alone.
  const faces = [...others.slice(0, 3), state.self];
  const extra = Math.max(0, others.length - 3);
  const count = `${others.length} collaborator${others.length === 1 ? "" : "s"} active in this file`;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id="presence-tools"
          aria-label="Multiplayer tools"
          data-presence-count={others.length}
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-1 text-foreground-3 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-muted"
        >
          <span role="img" aria-label={count} className="flex items-center -space-x-1.5">
            {faces.map((person) => (
              <span key={person.id} className="rounded-full ring-2 ring-background">
                <Avatar person={person} />
              </span>
            ))}
            {extra ? (
              <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs text-foreground-2 ring-2 ring-background">
                +{extra}
              </span>
            ) : null}
          </span>
          <ChevronDownIcon
            className={cn("size-3 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={portalContainer()}>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          aria-label="Multiplayer tools"
          className="z-50 w-presence-popover overflow-hidden rounded-2xl border border-presence-edge bg-presence-popover text-popover-foreground shadow-menu outline-hidden"
        >
          <ToolsPopover />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function Presence() {
  const slot = usePresenceSlot();
  return slot ? createPortal(<PresenceButton />, slot) : null;
}
