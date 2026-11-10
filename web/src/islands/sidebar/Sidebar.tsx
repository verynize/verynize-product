// Left sidebar (contents of aside#layer-panel): file header, Pages, Components, Layers.
import { useEffect, useState } from "react";
import { useBodyClass } from "@/lib/bridge";
import { FileHeader } from "./FileHeader";
import { PagesSection } from "./PagesSection";
import { LayersSection } from "./LayersSection";
import { ComponentsSection } from "./ComponentsSection";

const STORAGE_KEY = "bd-sidebar-sections";

type Sections = { pages: boolean; components: boolean; layers: boolean };

function loadSections(): Sections {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved.pages === "boolean" && typeof saved.layers === "boolean")
      return { pages: saved.pages, layers: saved.layers, components: saved.components === true };
  } catch {
    /* ignore corrupt preference */
  }
  return { pages: true, components: false, layers: true };
}

export function Sidebar() {
  const collapsed = useBodyClass("left-collapsed");
  const [sections, setSections] = useState(loadSections);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
    } catch {
      /* storage full: the preference is cosmetic */
    }
  }, [sections]);

  // Stay mounted while hidden: `#layer-search` / `#add-page` must exist for legacy code and tests.
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-xs text-foreground-2"
      hidden={collapsed}
    >
      <FileHeader onCollapse={() => document.body.classList.add("left-collapsed")} />
      <div data-sidebar-sections className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PagesSection
          open={sections.pages}
          onToggle={() => setSections((s) => ({ ...s, pages: !s.pages }))}
        />
        <ComponentsSection
          open={sections.components}
          onToggle={() => setSections((s) => ({ ...s, components: !s.components }))}
        />
        <LayersSection
          open={sections.layers}
          onToggle={() => setSections((s) => ({ ...s, layers: !s.layers }))}
        />
      </div>
    </div>
  );
}
