// Size alerts outside the Share panel: a toast when the open document crosses 80 % of a limit or
// goes over one, and a blocking dialog when a sync, save or share was stopped by a limit while the
// Share panel is closed (inside it, the meter shows the error: a native modal dialog would cover ours).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWindowEvent } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStorageReport, type Level, type StorageProblem } from "./limits";
import { worstLevel } from "./storage-meter";

const RANK: Record<Level, number> = { ok: 0, warn: 1, over: 2 };

export function StorageAlerts() {
  const report = useStorageReport();
  const [blocked, setBlocked] = useState<StorageProblem | null>(null);
  // The problem the toast is about ("level:scope:page"): a new one is announced once, a cleared
  // one dismisses it, and growing or shrinking sizes of the same problem stay quiet.
  const previous = useRef("ok");
  useEffect(() => {
    if (!report) return;
    const level = worstLevel(report.problems);
    const problem = report.problems[0];
    const key = problem ? `${level}:${problem.scope}:${problem.pageId ?? ""}` : "ok";
    const before = previous.current;
    previous.current = key;
    if (blocked) {
      toast.dismiss("storage-limit");
      return;
    }
    if (key === before) return;
    if (!problem) toast.dismiss("storage-limit");
    else if (RANK[level] < RANK[(before.split(":")[0] as Level) || "ok"])
      toast.dismiss("storage-limit");
    else if (level === "over") toast.error(problem.message, { id: "storage-limit" });
    else toast.warning(problem.message, { id: "storage-limit" });
  }, [report, blocked]);

  useWindowEvent(
    "storage-limit-error",
    useCallback((event: Event) => {
      if (document.getElementById("cloud-dialog")?.hasAttribute("open")) return;
      toast.dismiss("storage-limit");
      setBlocked((event as CustomEvent<StorageProblem>).detail);
    }, []),
  );
  useWindowEvent(
    "document-will-change",
    useCallback(() => {
      setBlocked(null);
      previous.current = "ok";
      toast.dismiss("storage-limit");
    }, []),
  );
  // web/image-upload.js refuses an image before it reaches the canvas ("add image").
  const imageRefused = blocked?.action === "add image";
  return (
    <Dialog open={!!blocked} onOpenChange={(open) => !open && setBlocked(null)}>
      <DialogContent id="storage-limit-dialog" className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {imageRefused ? "Image not added" : `File is too large to ${blocked?.action ?? "sync"}`}
          </DialogTitle>
          <DialogDescription>{blocked?.message}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {imageRefused
            ? "The canvas was not changed. Remove large images, or split the page or file, then add the image again."
            : blocked?.action === "sync"
              ? "Your changes are kept on this device and will sync once the file fits. Remove unused content or move it to another file."
              : "Your changes are still in the editor. Remove unused content or move it to another file, then try again."}
        </p>
        <DialogFooter>
          <Button size="sm" onClick={() => setBlocked(null)} aria-label="Close size error">
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
