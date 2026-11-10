// Island entry: inspector. Owned by the "inspector" workstream (see web/src/islands/README.md).
// Renders the contents of `aside#properties`: header, Variables and Properties (design/wonder 11, 22, 25, 41–43).
import { useEffect, useLayoutEffect, useState } from "react";
import { mountIsland } from "@/lib/mount";
import { useDesign, useSelection } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./inspector/header";
import { detachLegacyForm, setupInspector } from "./inspector/legacy";
import { primaryNode } from "./inspector/model";
import { PropertiesBody } from "./inspector/properties";
import { PanelSectionHeader, VariablesSection } from "./inspector/variables";
import { IconsSection } from "./inspector/icons";
import {
  PreviewElementBody,
  usePreviewEditMode,
  usePreviewElement,
} from "./inspector/preview-element";
import "./inspector/inspector.css";

// Input modality for inspector.css: a pointer press hides the focus ring Radix restores on its trigger after a menu
// closes; any navigation key (not Escape, which only closes the menu) brings keyboard rings back.
const NAV_KEYS = new Set([
  "Tab",
  "Enter",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);
const modality = (value: "pointer" | "keyboard") => {
  if (document.documentElement.dataset.inputModality !== value)
    document.documentElement.dataset.inputModality = value;
};
window.addEventListener("pointerdown", () => modality("pointer"), true);
window.addEventListener(
  "keydown",
  (event) => NAV_KEYS.has(event.key) && modality("keyboard"),
  true,
);

function Island() {
  useLayoutEffect(detachLegacyForm, []);
  const doc = useDesign();
  const selection = useSelection();
  const node = primaryNode(doc, selection);
  const previewElement = usePreviewElement();
  const previewEditing = usePreviewEditMode();
  const selected = !!node;
  // Variables start collapsed and Properties expanded; with nothing selected Properties shows the page settings.
  // The user can still toggle either; the automatic state is re-applied when the selection empties or fills.
  // Accordion (Wonder): every open section shares the panel height and scrolls inside, so collapsed sections below an
  // open one sit at the bottom of the panel; with nothing open they stack under each other. Each expanded section
  // keeps a usable body at short window heights; the outer scroll then keeps every section reachable.
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [iconsOpen, setIconsOpen] = useState(false);
  useEffect(() => {
    setVariablesOpen(false);
    setPropertiesOpen(true);
  }, [selected]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-xs text-foreground-2">
      <PanelHeader />
      <VariablesSection open={variablesOpen} onToggle={() => setVariablesOpen(!variablesOpen)} />
      <IconsSection
        doc={doc}
        node={node}
        open={iconsOpen}
        onToggle={() => setIconsOpen(!iconsOpen)}
        className={iconsOpen ? "min-h-24 flex-1" : "min-h-9 shrink-0"}
      />
      <section
        id="insp-properties"
        aria-label="Properties"
        className={cn(
          "flex flex-col border-b border-divider",
          propertiesOpen ? "min-h-24 flex-1" : "min-h-9 shrink-0",
        )}
      >
        <PanelSectionHeader
          label="Properties"
          open={propertiesOpen}
          onToggle={() => setPropertiesOpen(!propertiesOpen)}
        />
        <div
          hidden={!propertiesOpen}
          data-scroll
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          {previewElement ? <PreviewElementBody element={previewElement.element} /> : null}
          {/* Stays mounted while a preview element is shown: app.js toggles #shader-settings on every render. */}
          <div hidden={!!previewElement || previewEditing}>
            <PropertiesBody doc={doc} node={node} selection={selection} />
          </div>
        </div>
      </section>
    </div>
  );
}

mountIsland("inspector", setupInspector, () => <Island />);
