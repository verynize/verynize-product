// Component section (design/component-audit/README.md "Inspector"; Figma 02 main, 11/25 instance, 09 slot, 12
// instance actions): what the selected layer is in the component system and what can be done with it.
// - Main: its name, Create instance, the instance count and its slots.
// - Instance: the main's name (Go to main component), a missing-main notice, Reset overrides with a count, Detach,
//   and each slot with a Default / Modified badge (Modified slots can be reset on their own).
// - A layer inside an instance: the main's name and Reset overrides for that layer.
// - A slot of a main: its name and Remove slot; a frame inside a main: Convert to slot.
// Every action goes through window.design.components or the canvas `component.*` commands (one undo step each).
import { RotateCcw, TriangleAlert, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComponentInstanceIcon, ComponentMainIcon, SlotIcon } from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import {
  componentInfo,
  detachInstance,
  goToMain,
  resetOverrides,
  runComponentCommand,
  setSlot,
  type ComponentInfo,
  type SlotInfo,
} from "@/lib/components";
import { cn } from "@/lib/utils";
import { IconButton, Section } from "./controls";
import { pageNodes, type Node } from "./model";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function insideMain(doc: DesignDocument, node: Node) {
  const byId = new Map(pageNodes(doc).map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (
    let p = byId.get(node.parentId ?? "");
    p && !seen.has(p.id);
    p = byId.get(p.parentId ?? "")
  ) {
    seen.add(p.id);
    if (p.component === true) return true;
  }
  return false;
}

/** The row naming a main component; on an instance it is a button that goes to the main. */
function MainName({ info, onGo }: { info: ComponentInfo; onGo?: () => void }) {
  const Icon = info.role === "main" ? ComponentMainIcon : ComponentInstanceIcon;
  const name = info.mainName ?? "Missing main component";
  const label = (
    <>
      <Icon className="size-3.5 shrink-0 text-component" />
      <span className="truncate">{name}</span>
    </>
  );
  if (!onGo || info.missingMain)
    return (
      <div className="flex h-6 min-w-0 items-center gap-1.5 text-component-foreground">{label}</div>
    );
  return (
    <button
      type="button"
      id="component-go-to-main"
      title="Go to main component"
      className="-mx-1 flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-component-foreground hover:bg-muted"
      onClick={onGo}
    >
      {label}
    </button>
  );
}

function SlotState({ state }: { state: SlotInfo["state"] }) {
  const modified = state === "modified";
  return (
    <span
      data-slot-state={modified ? "modified" : "default"}
      className={cn(
        "shrink-0 rounded-sm px-1.5 text-xs leading-5",
        modified ? "bg-slot-tint text-slot-foreground" : "bg-input text-muted-foreground",
      )}
    >
      {modified ? "Modified" : "Default"}
    </span>
  );
}

function SlotRow({ slot, onReset }: { slot: SlotInfo; onReset?: () => void }) {
  return (
    <div data-slot-row={slot.id} className="flex h-6 min-w-0 items-center gap-1.5">
      <SlotIcon className="size-3.5 shrink-0 text-slot" />
      <span className="min-w-0 flex-1 truncate text-foreground-2">{slot.name}</span>
      {slot.state ? <SlotState state={slot.state} /> : null}
      {onReset ? (
        <IconButton
          icon={RotateCcw}
          label={`Reset ${slot.name}`}
          disabled={slot.state !== "modified"}
          onClick={onReset}
        />
      ) : null}
    </div>
  );
}

function Missing({ info }: { info: ComponentInfo }) {
  if (!info.missingMain && !info.cyclic) return null;
  return (
    <p id="component-missing" className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      {info.missingMain
        ? "Missing main component. The instance keeps its last state; detach it to edit it freely."
        : "This main component contains an instance of itself, so it is not synced."}
    </p>
  );
}

export function ComponentSection({ doc, node }: { doc: DesignDocument; node: Node }) {
  const info = componentInfo(node.id);
  const role = info?.role ?? null;

  if (info && role === "main") {
    return (
      <Section id="component-section" title="Component">
        <MainName info={info} />
        <div className="flex items-center justify-between gap-2">
          <span id="component-instance-count" className="text-xs text-muted-foreground">
            {plural(info.instanceCount, "instance")}
          </span>
          <Button
            id="component-create-instance"
            variant="secondary"
            size="sm"
            onClick={() => runComponentCommand("component.instance")}
          >
            <ComponentInstanceIcon className="size-3.5" />
            Create instance
          </Button>
        </div>
        <Missing info={info} />
        {info.slots.length ? (
          <div className="flex flex-col">
            {info.slots.map((slot) => (
              <SlotRow key={slot.id} slot={slot} />
            ))}
          </div>
        ) : null}
      </Section>
    );
  }

  if (info && role === "instance") {
    return (
      <Section
        id="component-section"
        title="Instance"
        tools={
          <IconButton
            id="component-detach"
            icon={Unlink}
            label="Detach instance"
            onClick={() => detachInstance(node.id)}
          />
        }
      >
        <MainName info={info} onGo={() => goToMain(node.id)} />
        <Missing info={info} />
        {info.slots.length ? (
          <div className="flex flex-col">
            {info.slots.map((slot) => (
              <SlotRow key={slot.id} slot={slot} onReset={() => resetOverrides([slot.id])} />
            ))}
          </div>
        ) : null}
        <Button
          id="component-reset"
          variant="secondary"
          size="sm"
          disabled={!info.overrideCount}
          onClick={() => resetOverrides([node.id], true)}
        >
          <RotateCcw className="size-3.5" />
          {info.overrideCount ? `Reset overrides (${info.overrideCount})` : "No overrides"}
        </Button>
      </Section>
    );
  }

  if (info && (role === "inherited" || role === "local" || (role === "slot" && info.instanceId))) {
    return (
      <Section id="component-section" title={role === "slot" ? "Slot" : "Instance layer"}>
        <MainName info={info} onGo={() => goToMain(node.id)} />
        {info.slot ? <SlotRow slot={info.slot} /> : null}
        {role === "local" ? (
          <p className="text-xs text-muted-foreground">Added in this instance only.</p>
        ) : (
          <Button
            id="component-reset"
            variant="secondary"
            size="sm"
            disabled={!info.overrideCount}
            onClick={() => resetOverrides([node.id])}
          >
            <RotateCcw className="size-3.5" />
            {info.overrideCount ? `Reset overrides (${info.overrideCount})` : "No overrides"}
          </Button>
        )}
      </Section>
    );
  }

  if (info && role === "slot") {
    return (
      <Section
        id="component-section"
        title="Slot"
        tools={
          <Button
            id="component-remove-slot"
            variant="ghost"
            size="xs"
            onClick={() => setSlot(node.id, false)}
          >
            Remove slot
          </Button>
        }
      >
        {info.slot ? <SlotRow slot={{ id: info.slot.id, name: info.slot.name }} /> : null}
        <p className="text-xs text-muted-foreground">
          Each instance of {info.mainName ?? "the component"} can fill this slot with its own
          layers.
        </p>
      </Section>
    );
  }

  if (node.type === "frame" && !role && insideMain(doc, node)) {
    return (
      <Section
        id="component-section"
        title="Component"
        tools={
          <Button
            id="component-convert-slot"
            variant="ghost"
            size="xs"
            onClick={() => setSlot(node.id, true)}
          >
            <SlotIcon className="size-3.5 text-slot" />
            Convert to slot
          </Button>
        }
      />
    );
  }
  return null;
}
