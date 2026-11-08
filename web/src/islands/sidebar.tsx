// Island entry: sidebar. Owned by the "sidebar" workstream (see web/src/islands/README.md).
import { takeOver } from "@/lib/bridge";
import { mountIsland } from "@/lib/mount";
import { Sidebar } from "./sidebar/Sidebar";
import { quarantineLegacyPanel, sidebarRoot } from "./sidebar/legacy";
import "./sidebar/sidebar.css";

// Hide the legacy/parity panel content right away (the island script runs after the legacy scripts), so
// tests never see e.g. parity's `.app-menu-trigger` in the window before React's first commit.
const root = sidebarRoot();
quarantineLegacyPanel(root);
// Nothing legacy looks `#add-page` up after load, so it can be freed now; the island button claims the id on commit.
takeOver("add-page");

mountIsland(
  "sidebar",
  () => root,
  () => <Sidebar />,
);
