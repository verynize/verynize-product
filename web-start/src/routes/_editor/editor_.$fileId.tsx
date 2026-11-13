import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";

export const Route = createFileRoute("/_editor/editor_/$fileId")({ component: EditorFileArea });

function EditorFileArea() {
  useShellArea("/editor");
  return null;
}
