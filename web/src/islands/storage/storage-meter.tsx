// File size in the Share panel: the shared size of the open document against the room limits
// (web/storage-limits.js), the largest page, upload progress of room assets, warnings from 80 %
// of a limit and the blocking error of a sync, save or share that a limit stopped.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { TriangleAlertIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWindowEvent } from "@/lib/bridge";
import { Spinner } from "@/components/ui/spinner";
import {
  formatBytes,
  limits,
  useAssetStatus,
  useStorageReport,
  type Level,
  type StorageProblem,
} from "./limits";

const TONE: Record<Level, string> = {
  ok: "bg-primary",
  warn: "bg-warning",
  over: "bg-destructive",
};
const TEXT: Record<Level, string> = {
  ok: "text-foreground-2",
  warn: "text-warning",
  over: "text-destructive",
};

/** The worst level among the report's problems. */
export const worstLevel = (problems: StorageProblem[]): Level =>
  problems.some((p) => p.level === "over") ? "over" : problems.length ? "warn" : "ok";

function ProblemRow({ problem }: { problem: StorageProblem }) {
  const Icon = problem.level === "over" ? CircleAlertIcon : TriangleAlertIcon;
  const pageId = problem.scope === "page" ? problem.pageId : null;
  return (
    <li
      data-storage-problem={problem.level}
      data-scope={problem.scope}
      className={cn("flex items-start gap-1.5", TEXT[problem.level])}
    >
      <Icon className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {problem.message}
        {pageId && (
          <button
            type="button"
            className="ml-1 h-auto min-h-0 border-0 bg-transparent p-0 text-xs text-primary-text underline-offset-2 hover:bg-transparent hover:underline"
            aria-label="Show this page"
            onClick={() => window.design?.setActivePage(pageId)}
          >
            Show page
          </button>
        )}
      </span>
    </li>
  );
}

export function StorageMeter() {
  const report = useStorageReport();
  const assets = useAssetStatus();
  const [blocked, setBlocked] = useState<StorageProblem | null>(null);
  useWindowEvent(
    "storage-limit-error",
    useCallback((event: Event) => setBlocked((event as CustomEvent<StorageProblem>).detail), []),
  );
  // Measure when the Share panel opens, so the size is current without waiting for the debounce.
  useEffect(() => {
    const dialog = document.getElementById("cloud-dialog");
    if (!dialog) return;
    const observer = new MutationObserver(() => {
      if (dialog.hasAttribute("open")) limits()?.refresh();
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  const api = limits();
  if (!api || !report) return null;
  const limit = api.DOCUMENT_LIMIT_BYTES;
  const level = worstLevel(report.problems);
  const percent = Math.min(100, (report.total / limit) * 100);
  const largest = report.pages.reduce<(typeof report.pages)[number] | null>(
    (best, page) => (!best || page.bytes > best.bytes ? page : best),
    null,
  );
  const creating = assets?.creating;
  const uploading = creating ? creating.total - creating.done : (assets?.uploading ?? 0);
  return (
    <section
      id="storage-meter"
      data-level={level}
      aria-label="File size"
      className="mt-2 flex flex-col gap-1.5 rounded-lg border border-card-border bg-card px-3 py-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">File size</span>
        <span data-storage-total className={cn("tabular-nums", TEXT[level])}>
          {formatBytes(report.total)} of {formatBytes(limit)}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Shared file size"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(report.total, limit)}
        aria-valuetext={`${formatBytes(report.total)} of ${formatBytes(limit)}`}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full w-(--bd-storage-used) rounded-full", TONE[level])}
          style={{ "--bd-storage-used": `${percent}%` } as CSSProperties}
        />
      </div>
      {largest && report.pages.length > 1 && (
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span className="truncate">Largest page: {largest.name}</span>
          <span className="tabular-nums">
            {formatBytes(largest.bytes)} of {formatBytes(api.PAGE_LIMIT_BYTES)}
          </span>
        </div>
      )}
      {report.inline.count > 0 && (
        <p className="text-muted-foreground">
          {report.inline.count} embedded file{report.inline.count === 1 ? "" : "s"} (
          {formatBytes(report.inline.bytes)}) will be stored separately when shared and do not
          count.
        </p>
      )}
      {uploading > 0 && (
        <p
          data-storage-uploading
          className="flex items-center gap-1.5 text-foreground-2"
          role="status"
        >
          <Spinner className="size-3" aria-hidden />
          {creating
            ? `Uploading ${creating.total} file${creating.total === 1 ? "" : "s"} · ${creating.done} of ${creating.total}`
            : `Uploading ${uploading} file${uploading === 1 ? "" : "s"}`}
        </p>
      )}
      {report.problems.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="File size warnings">
          {report.problems.slice(0, 4).map((problem, i) => (
            <ProblemRow key={`${problem.scope}-${problem.pageId ?? ""}-${i}`} problem={problem} />
          ))}
          {level === "warn" && (
            <li className="text-muted-foreground">
              Embedded images are moved to room assets when shared. Move content to another file to
              stay under the shared file limit.
            </li>
          )}
        </ul>
      )}
      {blocked && (
        <div
          id="storage-limit-error"
          role="alert"
          className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{blocked.message}</span>
          <button
            type="button"
            aria-label="Dismiss size error"
            className="h-auto min-h-0 shrink-0 rounded-sm border-0 bg-transparent p-0.5 text-destructive hover:bg-destructive/10"
            onClick={() => setBlocked(null)}
          >
            <XIcon className="size-3" aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
