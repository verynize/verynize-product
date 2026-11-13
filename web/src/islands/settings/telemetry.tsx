// Preferences › Privacy: the crash-report opt-in (off by default). Desktop: desktop/telemetry.cjs (userData); web:
// localStorage (@/lib/telemetry/runtime). Turning it on starts reporting after a restart or reload; turning it off
// stops sending at once. `#settings-telemetry-toggle` is a test contract (tests/telemetry-desktop.cjs).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  setTelemetryEnabled,
  telemetryStatus,
  type TelemetryStatus,
} from "@/lib/telemetry/runtime";
import { platform } from "@/lib/platform";
import { Card, Row, Section, Toggle } from "./controls";

const TITLE = "Send crash reports";

function note(status: TelemetryStatus | null) {
  if (!status) return "";
  if (!status.available) return "Crash reporting is not set up in this build.";
  if (status.restartRequired)
    return platform.kind === "desktop"
      ? "Restart Verynize to start sending reports."
      : "Reload the page to start sending reports.";
  return "";
}

export function TelemetrySection() {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    telemetryStatus().then(
      (value) => live && setStatus(value),
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
  }, []);
  const change = async (enabled: boolean) => {
    setBusy(true);
    try {
      setStatus(await setTelemetryEnabled(enabled));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const hint = note(status);
  return (
    <Section id="settings-privacy" title="Privacy">
      <Card>
        <Row
          title={TITLE}
          description={
            <>
              Errors and crashes, with app version and system details. Never your designs, prompts,
              file paths, email or account. Off unless you turn it on.
              {hint && <span className="block">{hint}</span>}
            </>
          }
        >
          <Toggle
            id="settings-telemetry-toggle"
            aria-label={TITLE}
            checked={status?.enabled ?? false}
            disabled={!status || busy}
            onCheckedChange={(checked) => void change(checked)}
          />
        </Row>
      </Card>
    </Section>
  );
}
