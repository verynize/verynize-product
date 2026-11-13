import { useEffect, useState } from "react";
import { FilePlus, LayoutGrid, Settings, Upload } from "lucide-react";
import { ensureContainer, mountIsland } from "@/lib/mount";
import { Toaster } from "@/components/ui/sonner";
import { TextPrompt } from "../settings/text-prompt";
import { HomeButton } from "./menu";
import { library } from "./library";

function HomeChrome() {
  const [editor, setEditor] = useState(() => !!document.documentElement.dataset.legacyEditor);
  useEffect(() => {
    const started = () => setEditor(true);
    window.addEventListener("verynize:editor-started", started);
    return () => window.removeEventListener("verynize:editor-started", started);
  }, []);
  if (editor) return null;
  return (
    <>
      <div className="flex h-chrome items-center gap-2 border-b border-edge bg-background px-4">
        <HomeButton onClick={() => library().showHome()}>
          <LayoutGrid />
          Files
        </HomeButton>
        <div className="flex-1" />
        <HomeButton onClick={() => void library().create()}>
          <FilePlus />
          New file
        </HomeButton>
        <HomeButton
          onClick={async () => {
            await window.verynizeEditorBoot?.();
            document.getElementById("project-file")?.click();
          }}
        >
          <Upload />
          Import
        </HomeButton>
        <HomeButton onClick={() => window.appSettings?.open("preferences")}>
          <Settings />
          Settings
        </HomeButton>
      </div>
      <TextPrompt />
      <Toaster position="bottom-right" offset={16} visibleToasts={3} />
    </>
  );
}
mountIsland(
  "home-chrome",
  () => ensureContainer("bd-home-chrome"),
  () => <HomeChrome />,
);
