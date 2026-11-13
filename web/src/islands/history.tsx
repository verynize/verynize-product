// Island entry: history. Per-artboard version history panel (docs/version-history.md) over
// window.versionHistory (web/version-history.js), opened with bd:open-version-history.
import { mountIsland, ensureContainer } from "@/lib/mount";
import { VersionPanel } from "./history/version-panel";

mountIsland(
  "history",
  () => ensureContainer("bd-history-root"),
  () => <VersionPanel />,
);
