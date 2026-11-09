// The desktop's one-time crash-report question (desktop/telemetry.cjs `asked`), shown after first-run setup and to
// profiles that set up before it existed, only when this build can report and the user never answered (here or in
// Settings › Preferences › Privacy). Closing it counts as "Not now"; the setting can change the answer later.
// Not shown in automated runs (onboardingState().skip). Test contract: `#telemetry-prompt`, `#telemetry-prompt-allow`,
// `#telemetry-prompt-deny`.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { platform } from "@/lib/platform";
import { setTelemetryEnabled, telemetryStatus } from "@/lib/telemetry/runtime";

export function TelemetryPrompt() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const desktop = platform.desktop;
    if (!desktop) return;
    Promise.all([desktop.onboardingState(), telemetryStatus()]).then(
      ([{ skip }, status]) => {
        if (live && !skip && status?.available && status.asked === false) setOpen(true);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  const answer = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const status = await setTelemetryEnabled(enabled);
      setOpen(false);
      if (status.restartRequired) toast("Crash reports start the next time Verynize opens.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && void answer(false)}>
      <DialogContent id="telemetry-prompt" className="max-w-sm sm:max-w-sm">
        <DialogTitle>Send crash reports?</DialogTitle>
        <DialogDescription>
          When Verynize crashes or hits an error, it can send the error, app version and system
          details so it gets fixed. Never your designs, prompts, file paths, email or account. You
          can change this in Settings › Preferences › Privacy.
        </DialogDescription>
        <DialogFooter>
          <Button
            id="telemetry-prompt-deny"
            variant="ghost"
            disabled={busy}
            onClick={() => void answer(false)}
          >
            Not now
          </Button>
          <Button id="telemetry-prompt-allow" disabled={busy} onClick={() => void answer(true)}>
            Send crash reports
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
