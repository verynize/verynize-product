import { platform } from "@/lib/platform";
// Usage ring beside Send (29, 35, 51, 72) and its popover: the provider account's plan limits (5-hour, weekly, per
// model; desktop/agent-usage.cjs, refreshed by rate-limit events of the chat's runs) and the chat's context window
// with a breakdown. The ring shows the most constraining value.
import { useState, type ReactNode } from "react";
import { ChevronRightIcon, GaugeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  readContext,
  refreshAccountUsage,
  useAccountUsage,
  type AccountLimit,
  type ContextBreakdown,
} from "./agent-status";
import { hook } from "./hooks";
import type { ChatState, ChatUsage } from "./store";

export const formatTokens = (value?: number) => {
  if (value === undefined || !Number.isFinite(value)) return "–";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
};
export const formatCost = (value?: number) =>
  value === undefined || !Number.isFinite(value)
    ? ""
    : value < 0.01 && value > 0
      ? "<$0.01"
      : `$${value.toFixed(2)}`;
/** "106.6K", "1.0M", "840". */
export const compactTokens = (value?: number) => {
  if (value === undefined || !Number.isFinite(value)) return "–";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
};
/** "10:40 PM" today, "Sat 11:00 AM" within a week, else "Nov 5, 2:41 PM". */
export function formatReset(at: number, now = Date.now()) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  if (at - now < 6 * 86_400_000 && at > now)
    return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
const percentLabel = (value: number) => `${Math.round(value)}% used`;

/** Share of the context window in use, 0–1 (0 when the window is unknown). */
export function contextShare(usage?: ChatUsage): number {
  if (!usage?.contextWindow || !usage.inputTokens) return 0;
  return Math.min(1, Math.max(0, usage.inputTokens / usage.contextWindow));
}

/** One-line turn summary: "12k in · 840 out · $0.04". */
export function usageSummary(usage: ChatUsage): string {
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`${formatTokens(usage.inputTokens)} in`);
  if (usage.outputTokens !== undefined) parts.push(`${formatTokens(usage.outputTokens)} out`);
  const cost = formatCost(usage.costUsd);
  if (cost) parts.push(cost);
  return parts.join(" · ");
}

// "Weekly Opus limit" (run events) and "Weekly limit · Opus" (account read) are the same window.
const limitKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .sort()
    .join(" ");

/** Account limits, updated by the newer rate-limit events of the chat's runs; run-only limits are appended. */
export function mergeLimits(
  account: AccountLimit[] = [],
  live: NonNullable<ChatUsage["rateLimit"]> = [],
): AccountLimit[] {
  const out = account.map((limit) => ({ ...limit }));
  for (const event of live) {
    const same = out.find((limit) => limitKey(limit.label) === limitKey(event.label));
    if (same)
      Object.assign(same, {
        usedPercent: event.usedPercent,
        ...(event.resetsAt ? { resetsAt: event.resetsAt } : {}),
      });
    else
      out.push({
        id: "live:" + limitKey(event.label),
        label: event.label,
        usedPercent: event.usedPercent,
        ...(event.resetsAt ? { resetsAt: event.resetsAt } : {}),
      });
  }
  return out;
}

/** The most constraining share, 0–1: context window or any plan limit. */
export function ringShare(usage: ChatUsage | undefined, limits: AccountLimit[]): number {
  return Math.min(
    1,
    Math.max(contextShare(usage), ...limits.map((limit) => limit.usedPercent / 100), 0),
  );
}

function Ring({ share }: { share: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const high = share >= 0.8;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn(hook.usageRing, "size-4 -rotate-90")}>
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        className="text-edge"
      />
      {share > 0 && (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.5, share * c)} ${c}`}
          className={cn(
            "transition-all duration-300 motion-reduce:transition-none",
            high ? "text-destructive" : "text-muted-foreground",
          )}
        />
      )}
    </svg>
  );
}

function Meter({
  id,
  label,
  aside,
  value,
  note,
  tone = "limit",
}: {
  id: string;
  label: ReactNode;
  aside: string;
  value?: number;
  note?: string;
  tone?: "limit" | "context";
}) {
  return (
    <div data-usage-row={id} className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-foreground">{label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{aside}</span>
      </div>
      {value !== undefined && (
        <Progress
          value={value}
          aria-label={typeof label === "string" ? label : id}
          tone={tone === "context" ? "muted" : value >= 80 ? "destructive" : "default"}
        />
      )}
      {note && <span className="text-sm text-muted-foreground tabular-nums">{note}</span>}
    </div>
  );
}

function ContextSection({
  usage,
  breakdown,
}: {
  usage?: ChatUsage;
  breakdown: ContextBreakdown | null;
}) {
  const [open, setOpen] = useState(false);
  const max = breakdown?.maxTokens ?? usage?.contextWindow;
  const used = breakdown?.totalTokens || usage?.inputTokens;
  const percent = breakdown?.percentage ?? (max && used ? (used / max) * 100 : undefined);
  const rows = breakdown?.categories.filter((c) => c.kind !== "free").length
    ? breakdown.categories
        .filter((c) => c.kind !== "free")
        .map((c) => ({ label: c.name, value: compactTokens(c.tokens) }))
    : [
        ...(usage?.inputTokens !== undefined
          ? [{ label: "Input", value: compactTokens(usage.inputTokens) }]
          : []),
        ...(usage?.outputTokens !== undefined
          ? [{ label: "Output", value: compactTokens(usage.outputTokens) }]
          : []),
        ...(formatCost(usage?.costUsd)
          ? [{ label: "Cost", value: formatCost(usage?.costUsd) }]
          : []),
      ];
  const note =
    used !== undefined
      ? max
        ? `${compactTokens(used)} / ${compactTokens(max)} tokens`
        : `${compactTokens(used)} tokens`
      : "No messages yet";
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-usage-row="context">
      <div className="flex flex-col gap-1.5 py-1">
        <div className="flex items-center justify-between gap-3 text-sm">
          {rows.length ? (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 rounded-sm text-foreground-2 outline-hidden hover:text-foreground focus-visible:text-foreground"
              >
                Context window
                <ChevronRightIcon
                  className={cn(
                    "size-3 transition-transform motion-reduce:transition-none",
                    open && "rotate-90",
                  )}
                />
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="text-foreground-2">Context window</span>
          )}
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {percent !== undefined ? percentLabel(percent) : "–"}
          </span>
        </div>
        <Progress value={percent ?? 0} aria-label="Context window" tone="muted" />
        <span className="text-sm text-muted-foreground tabular-nums">{note}</span>
        <CollapsibleContent>
          <ul data-context-breakdown="" className="flex flex-col gap-0.5 pt-1">
            {rows.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{row.label}</span>
                <span className="text-foreground-2 tabular-nums">{row.value}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function UsageRing({ state }: { state: ChatState }) {
  const agent = state.defaults.agent === "codex" ? "codex" : "claude";
  const usage = state.usage ?? state.messages.findLast((m) => m.usage)?.usage;
  const { account } = useAccountUsage(agent);
  const [open, setOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const accountLimits = account?.status === "ready" ? account.limits : [];
  const limits = mergeLimits(accountLimits, usage?.rateLimit);
  const share = ringShare(usage, limits);
  const percent = Math.round(share * 100);
  const name = agent === "codex" ? "Codex" : "Claude";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        void refreshAccountUsage(agent);
        setBreakdown(null);
        if (state.busy && agent === "claude")
          void readContext(state.conversationId).then(setBreakdown);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} usage ${percent}% used`}
          data-chat-indicator="usage"
        >
          <Ring share={share} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        data-chat-popover="usage"
        className="w-80"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2 pb-1">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-foreground">{name} usage</span>
              {account?.email && (
                <span data-usage-email="" className="truncate text-sm text-muted-foreground">
                  {account.email}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open Settings › Usage"
              title="Settings › Usage"
              onClick={() => {
                setOpen(false);
                window.appSettings?.open("usage");
              }}
            >
              <GaugeIcon className="size-4" />
            </Button>
          </div>
          {limits.map((limit) => (
            <Meter
              key={limit.id}
              id={limit.id}
              label={limit.label}
              aside={percentLabel(limit.usedPercent)}
              value={limit.usedPercent}
              note={limit.resetsAt ? `Resets ${formatReset(limit.resetsAt)}` : undefined}
            />
          ))}
          {!limits.length && (
            <p data-usage-row="limits-message" className="py-1 text-sm text-muted-foreground">
              {account?.message || (account ? "No plan limits reported." : "Checking plan limits…")}
            </p>
          )}
          {agent === "codex" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void platform.desktop?.openExternal("https://chatgpt.com/settings/usage")
              }
            >
              Manage usage
            </Button>
          )}
          <Separator className="my-1.5" />
          <ContextSection usage={usage} breakdown={breakdown} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
