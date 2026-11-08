import { useCodexConnection } from "./codex-connection";
// Settings › Usage (ref 72): plan limits of the user's own Claude Code and Codex accounts
// (desktop/agent-usage.cjs) and Verynize's local count of AI-generated layers. There is no Verynize quota.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ExternalLinkIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import { ClaudeMark, CodexMark, LogoIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { agentWorkspace, settingsApi } from "./api";
import { Card, PageHeader, Row, Section, SettingsButton } from "./controls";
import { desktopApi, errorText, type Profile } from "./workspace-ipc";
import { can, platform } from "@/lib/platform";

type Limit = { id: string; label: string; usedPercent: number; resetsAt?: number };
export type ProviderUsage = {
  agent: "claude" | "codex";
  status: "ready" | "signed-out" | "unavailable" | "missing" | "error";
  message?: string;
  email?: string | null;
  organization?: string | null;
  plan?: string | null;
  limits: Limit[];
  extraUsage?: {
    enabled: boolean;
    used?: number;
    limit?: number;
    usedPercent?: number;
    currency?: string;
  } | null;
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: number } | null;
  resetCredits?: number;
  updatedAt?: number;
};
export type LayerUsage = {
  thisWeek: number;
  lastWeek: number;
  total: number;
  weekStart: number;
  resetsAt: number;
};
export type UsageIpc = {
  read(options: {
    agent: "claude" | "codex";
    refresh?: boolean;
    profile?: string;
  }): Promise<ProviderUsage>;
  layers(): Promise<LayerUsage>;
};

const usageIpc = (): Partial<UsageIpc> | undefined => platform.desktop?.agentUsage;
const openExternal = (url: string) => {
  if (can("externalLinks")) void platform.desktop?.openExternal(url);
  else window.open(url, "_blank", "noopener");
};

const PROVIDERS = [
  {
    id: "claude",
    name: "Claude Code",
    manage: "Manage on claude.ai",
    url: "https://claude.ai/settings/usage",
    mark: <ClaudeMark className="size-4" />,
  },
  {
    id: "codex",
    name: "Codex",
    manage: "Manage in ChatGPT",
    url: "https://chatgpt.com/settings/usage",
    mark: <CodexMark className="size-4" />,
  },
] as const;

/* ---------- formatting ---------- */
const MINUTE = 60_000;
const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function formatReset(resetsAt: number, now = Date.now()) {
  const left = Math.max(0, resetsAt - now);
  const days = Math.floor(left / (1440 * MINUTE));
  const hours = Math.floor((left % (1440 * MINUTE)) / (60 * MINUTE));
  const minutes = Math.floor((left % (60 * MINUTE)) / MINUTE);
  const span = days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : `${Math.max(1, minutes)}m`;
  const sameDay = new Date(resetsAt).toDateString() === new Date(now).toDateString();
  const when = sameDay
    ? timeOf(resetsAt)
    : `${new Date(resetsAt).toLocaleDateString([], { weekday: "short" })} ${timeOf(resetsAt)}`;
  return `Resets in ${span} (${when})`;
}
function formatUpdated(at: number | undefined, now: number) {
  if (!at) return "";
  const minutes = Math.floor((now - at) / MINUTE);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated at ${timeOf(at)}`;
}
const formatNumber = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 0 });
function formatMoney(value: number, currency = "USD") {
  try {
    return value.toLocaleString(undefined, { style: "currency", currency });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Re-render every 30s so "Resets in" and "Updated … ago" stay current. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/* ---------- pieces ---------- */
function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-81 shrink-0 overflow-hidden rounded-full bg-accent" role="presentation">
      <div
        className={cn(
          "h-full w-(--bd-used) rounded-full",
          value >= 90 ? "bg-destructive" : "bg-foreground-2",
        )}
        style={{ "--bd-used": `${Math.min(100, Math.max(0, value))}%` } as CSSProperties}
      />
    </div>
  );
}

function LimitRow({ limit, now }: { limit: Limit; now: number }) {
  return (
    <div data-usage-limit={limit.id} className="flex items-center gap-5 py-2.5">
      <div className="flex w-57 shrink-0 flex-col gap-px">
        <span className="text-sm text-foreground">{limit.label}</span>
        {limit.resetsAt ? (
          <span className="text-sm text-muted-foreground">{formatReset(limit.resetsAt, now)}</span>
        ) : null}
      </div>
      <Bar value={limit.usedPercent} />
      <span className="flex-1 text-right text-sm whitespace-nowrap text-foreground-2 tabular-nums">
        {Math.round(limit.usedPercent)}% used
      </span>
    </div>
  );
}

function ValueRow({ label, value, id }: { label: string; value: ReactNode; id?: string }) {
  return (
    <div data-usage-row={id} className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <span className="text-sm text-foreground-2 tabular-nums">{value}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-6 py-4" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-5">
          <div className="flex w-57 flex-col gap-2">
            <span className="h-3 w-24 animate-pulse rounded-sm bg-accent" />
            <span className="h-3 w-40 animate-pulse rounded-sm bg-muted" />
          </div>
          <span className="h-1.5 w-81 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  usage,
  loading,
  now,
}: {
  provider: { id: string; name: string; manage: string; url: string; mark: ReactNode };
  usage: ProviderUsage | null;
  loading: boolean;
  now: number;
}) {
  const ready = usage?.status === "ready";
  const showAccount = !!usage?.email;
  const updated = loading ? null : formatUpdated(usage?.updatedAt, now);
  return (
    <Section
      id={`settings-usage-${provider.id}`}
      title={
        <span className="flex items-center gap-2">
          {provider.mark}
          {provider.name}
        </span>
      }
    >
      <Card
        data-usage-agent={provider.id}
        data-usage-status={loading && !usage ? "loading" : usage?.status}
      >
        <div className="flex items-start justify-between gap-4 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            {showAccount ? (
              <div className="flex min-w-0 items-center gap-2">
                <span data-usage-email className="truncate text-sm text-foreground">
                  {usage?.email}
                </span>
                {usage?.plan && (
                  <span
                    data-usage-plan
                    className="rounded-sm border border-card-border bg-input px-1.5 text-xs leading-5 text-foreground-2"
                  >
                    {usage.plan}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">Default</span>
              </div>
            ) : (
              <span className="text-sm text-foreground">
                {loading && !usage ? "Checking your account…" : `${provider.name} account`}
              </span>
            )}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {usage?.organization && (
                <>
                  <span className="truncate">{usage.organization}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              {loading ? (
                <>
                  <LoaderCircleIcon className="size-3 animate-spin" />
                  <span>Updating…</span>
                </>
              ) : (
                <span data-usage-updated>{updated}</span>
              )}
            </div>
          </div>
          <SettingsButton onClick={() => openExternal(provider.url)}>
            {provider.manage}
            <ExternalLinkIcon />
          </SettingsButton>
        </div>
        {loading && !ready ? (
          <Skeleton />
        ) : !usage ? null : !ready ? (
          <div data-usage-message className="flex items-center justify-between gap-4 py-3.5">
            <span className="text-sm text-muted-foreground">{usage.message}</span>
            {(usage.status === "signed-out" || usage.status === "missing") && (
              <SettingsButton onClick={() => settingsApi()?.select("agents")}>
                Open Agents
              </SettingsButton>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col py-1.5">
              {usage.limits.length ? (
                usage.limits.map((limit) => <LimitRow key={limit.id} limit={limit} now={now} />)
              ) : (
                <span className="py-2.5 text-sm text-muted-foreground">
                  No limits reported for this plan.
                </span>
              )}
            </div>
            {usage.extraUsage && (
              <ValueRow
                id="extra-usage"
                label="Extra usage"
                value={
                  usage.extraUsage.enabled
                    ? usage.extraUsage.used !== undefined && usage.extraUsage.limit !== undefined
                      ? `On · ${formatMoney(usage.extraUsage.used, usage.extraUsage.currency)} of ${formatMoney(usage.extraUsage.limit, usage.extraUsage.currency)}`
                      : "On"
                    : "Off"
                }
              />
            )}
            {usage.credits && (
              <ValueRow
                id="credits"
                label="Credits"
                value={
                  usage.credits.unlimited
                    ? "Unlimited"
                    : usage.credits.hasCredits && usage.credits.balance !== undefined
                      ? `${formatNumber(usage.credits.balance)} left`
                      : "None"
                }
              />
            )}
            {!!usage.resetCredits && (
              <ValueRow
                id="reset-credits"
                label="Limit resets available"
                value={formatNumber(usage.resetCredits)}
              />
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

function VerynizeCard({ layers }: { layers: LayerUsage | null }) {
  const stats = agentWorkspace()?.getUsage?.() ?? {};
  const counters = [
    ["runs", "Tasks"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["queued", "Queued"],
  ] as const;
  const resets = layers
    ? new Date(layers.resetsAt).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";
  return (
    <section id="settings-usage" aria-labelledby="settings-usage-label" className="flex flex-col">
      <Card>
        <div className="flex flex-col gap-3 py-3.5">
          <div className="flex items-center justify-between gap-4 pt-1">
            <h2
              id="settings-usage-label"
              className="flex items-center gap-2.5 text-base font-medium text-foreground"
            >
              <LogoIcon className="size-4 text-foreground-3" />
              Verynize usage
            </h2>
            <span className="text-sm text-muted-foreground">On this Mac</span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-foreground">AI-generated layers</span>
              <span className="text-sm text-muted-foreground">
                <span
                  id="settings-usage-layers"
                  className="text-base font-medium text-foreground tabular-nums"
                >
                  {layers ? formatNumber(layers.thisWeek) : "—"}
                </span>{" "}
                this week
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              {layers
                ? `Layers agents added to your designs · ${formatNumber(layers.lastWeek)} last week · ${formatNumber(layers.total)} in total · New week starts ${resets}`
                : "Layers agents add to your designs are counted in the desktop app."}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 py-3.5">
          <span className="text-sm text-foreground">Agent tasks on this device</span>
          <div className="grid grid-cols-4 gap-4">
            {counters.map(([key, label]) => (
              <div key={key} data-usage-counter={key} className="flex flex-col">
                <span className="text-lg font-medium text-foreground tabular-nums">
                  {Number(stats[key]) || 0}
                </span>
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}

export function UsageView() {
  const codexConnection = useCodexConnection();
  const ipc = usageIpc();
  const available = typeof ipc?.read === "function";
  const now = useNow();
  const [usage, setUsage] = useState<Record<string, ProviderUsage | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [layers, setLayers] = useState<LayerUsage | null>(null);
  // Named accounts (Settings › Accounts): each gets its own card with its own limits.
  const [named, setNamed] = useState<Profile[]>([]);

  const load = useCallback(
    (refresh: boolean) => {
      if (!ipc?.read) return;
      if (ipc.layers) void ipc.layers().then(setLayers, () => setLayers(null));
      void desktopApi()
        ?.agentProfiles?.list()
        .then((list) => {
          const accounts = list.profiles.filter(
            (p) => !p.system && (p.agent !== "codex" || codexConnection.profiles.has(p.id)),
          );
          setNamed(accounts);
          const read = ipc.read;
          if (!read) return;
          for (const p of accounts) {
            const key = `${p.agent}:${p.id}`;
            setLoading((state) => ({ ...state, [key]: true }));
            read({ agent: p.agent, refresh, profile: p.id })
              .then(
                (value) => setUsage((state) => ({ ...state, [key]: value })),
                (error: unknown) =>
                  setUsage((state) => ({
                    ...state,
                    [key]: {
                      agent: p.agent,
                      status: "error",
                      message: errorText(error),
                      limits: [],
                      updatedAt: Date.now(),
                    },
                  })),
              )
              .finally(() => setLoading((state) => ({ ...state, [key]: false })));
          }
        })
        .catch(() => setNamed([]));
      for (const { id } of PROVIDERS.filter(
        (provider) => provider.id !== "codex" || codexConnection.profiles.has("system"),
      )) {
        setLoading((state) => ({ ...state, [id]: true }));
        ipc
          .read({ agent: id, refresh })
          .then(
            (value) => setUsage((state) => ({ ...state, [id]: value })),
            (error: unknown) =>
              setUsage((state) => ({
                ...state,
                [id]: {
                  agent: id,
                  status: "error",
                  message: error instanceof Error ? error.message : String(error),
                  limits: [],
                  updatedAt: Date.now(),
                },
              })),
          )
          .finally(() => setLoading((state) => ({ ...state, [id]: false })));
      }
    },
    [ipc, codexConnection],
  );
  useEffect(() => load(false), [load]);
  const busy = Object.values(loading).some(Boolean);

  return (
    <>
      <PageHeader
        title="Usage"
        description="Anthropic and OpenAI set these limits. They count everything you do with each account, in Verynize and anywhere else you use it."
        action={
          available && (
            <SettingsButton id="settings-usage-refresh" disabled={busy} onClick={() => load(true)}>
              <RotateCwIcon className={cn("size-3.5", busy && "animate-spin")} />
              Refresh
            </SettingsButton>
          )
        }
      />
      <div className="flex flex-col gap-12.5">
        <VerynizeCard layers={layers} />
        {available
          ? PROVIDERS.filter(
              (provider) => provider.id !== "codex" || codexConnection.profiles.has("system"),
            ).map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                usage={usage[provider.id] ?? null}
                loading={!!loading[provider.id]}
                now={now}
              />
            ))
          : null}
        {available &&
          named
            .filter((p) => p.agent !== "codex" || codexConnection.profiles.has(p.id))
            .map((p) => {
              const base = PROVIDERS.find((x) => x.id === p.agent)!;
              return (
                <ProviderCard
                  key={p.id}
                  provider={{
                    ...base,
                    id: `${p.agent}-account-${p.id}`,
                    name: `${base.name} · ${p.name}`,
                  }}
                  usage={usage[`${p.agent}:${p.id}`] ?? null}
                  loading={!!loading[`${p.agent}:${p.id}`]}
                  now={now}
                />
              );
            })}
        {available ? null : (
          <Card>
            <Row
              title="Available in the desktop app"
              description="Plan limits are read from the Claude Code and Codex accounts on this Mac."
            />
          </Card>
        )}
      </div>
    </>
  );
}
