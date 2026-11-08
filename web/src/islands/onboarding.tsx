// Island entry: onboarding. First-run setup (not a tutorial).
// - Desktop: a Verynize account, then the coding agents chats run on. Shown once per profile; skipped in automated
//   runs (desktop onboardingState().skip, VERYNIZE_SKIP_ONBOARDING=1).
// - Web: the web app signs in before the editor boots (web-sign-in.tsx), so the steps here set up the AI: connect
//   OpenRouter for web chat, Claude Code / Codex being desktop-only, then a summary. Shown once per account after
//   its first web sign-in: finishing or skipping is stored on the server (`PATCH /api/me {aiSetup: true}`, read back
//   as `aiSetupAt` from `GET /api/me`), with a per-account localStorage copy for when that request fails.
// `bd:open-onboarding` reopens it (Sign in entries on the desktop, Settings › Agents › AI setup on the web).
import { useEffect, useState, type ReactNode } from "react";
import { mountIsland, ensureContainer } from "@/lib/mount";
import { webAgentScope } from "@/lib/agent-transport";
import { cloudAccount, useCloudAccount } from "@/lib/cloud-account";
import { AccountStep } from "./onboarding/account-step";
import { AgentsStep } from "./onboarding/agents-step";
import { AiStep, ReadyStep } from "./onboarding/ai-step";
import "./onboarding/onboarding.css";
import { can, platform } from "@/lib/platform";

const DONE_KEY = "verynize.onboarding";
type Step = "account" | "agents" | "ai" | "ready" | "done";
const LABELS: Record<Exclude<Step, "done">, string> = {
  account: "Set up your account",
  agents: "Connect your agents",
  ai: "Set up your AI",
  ready: "Setup complete",
};

const finished = () => {
  try {
    return localStorage.getItem(DONE_KEY) === "done";
  } catch {
    return true;
  }
};

/** The full-window frame both flows share, above the settings screen (z 90) that can reopen it. */
function Frame({
  step,
  steps,
  children,
}: {
  step: Exclude<Step, "done">;
  steps: readonly Exclude<Step, "done">[];
  children: ReactNode;
}) {
  useEffect(() => {
    document.body.classList.add("onboarding-open");
    return () => document.body.classList.remove("onboarding-open");
  }, []);
  return (
    <div
      id="onboarding"
      data-step={step}
      role="dialog"
      aria-modal="true"
      aria-label={LABELS[step]}
      className="fixed inset-0 z-100 flex flex-col bg-background text-foreground"
    >
      <div data-drag="" className="h-chrome shrink-0" />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-chrome">
        {children}
      </div>
      <ul
        className="m-0 flex list-none justify-center gap-1.5 px-0 pt-0 pb-6"
        aria-label="Setup steps"
      >
        {steps.map((id) => (
          <li
            key={id}
            aria-current={id === step ? "step" : undefined}
            className={
              id === step
                ? "size-1.5 rounded-full bg-foreground"
                : "size-1.5 rounded-full bg-accent"
            }
          />
        ))}
      </ul>
    </div>
  );
}

function DesktopOnboarding() {
  const [step, setStep] = useState<Step | null>(null);
  useEffect(() => {
    const desktop = platform.desktop;
    if (!desktop || !can("onboarding")) return setStep("done");
    // "Sign in" entries (workspace switcher, Settings) open it again at any time.
    const reopen = () => setStep(cloudAccount()?.get() ? "agents" : "account");
    window.addEventListener("bd:open-onboarding", reopen);
    if (finished()) setStep("done");
    else
      desktop.onboardingState().then(
        ({ skip }) => setStep(skip ? "done" : cloudAccount()?.get() ? "agents" : "account"),
        () => setStep("done"),
      );
    return () => window.removeEventListener("bd:open-onboarding", reopen);
  }, []);

  if (step !== "account" && step !== "agents") return null;
  const finish = () => {
    try {
      localStorage.setItem(DONE_KEY, "done");
    } catch {}
    setStep("done");
  };
  return (
    <Frame step={step} steps={["account", "agents"]}>
      {step === "account" ? (
        <AccountStep onDone={() => setStep("agents")} />
      ) : (
        <AgentsStep onContinue={finish} />
      )}
    </Frame>
  );
}

const localKey = (accountId: string) => `verynize.web-ai-setup.${accountId}`;
const doneLocally = (accountId: string) => {
  try {
    return localStorage.getItem(localKey(accountId)) === "done";
  } catch {
    return false;
  }
};

function WebOnboarding() {
  const scope = webAgentScope(useCloudAccount());
  const accountId = scope?.accountId ?? "";
  const [step, setStep] = useState<Step | null>(null);
  // First sign-in of this account (on any browser): the server has no aiSetupAt yet.
  useEffect(() => {
    setStep(null);
    const api = cloudAccount();
    if (!accountId || !api || doneLocally(accountId)) return;
    let live = true;
    api.request<{ aiSetupAt?: number | null }>("/api/me").then(
      (me) => {
        if (live && me.aiSetupAt == null) setStep((current) => current ?? "ai");
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [accountId]);
  useEffect(() => {
    const reopen = () => setStep(accountId ? "ai" : null);
    window.addEventListener("bd:open-onboarding", reopen);
    return () => window.removeEventListener("bd:open-onboarding", reopen);
  }, [accountId]);

  if (step !== "ai" && step !== "ready") return null;
  const finish = () => {
    setStep("done");
    try {
      localStorage.setItem(localKey(accountId), "done");
    } catch {}
    void cloudAccount()
      ?.request("/api/me", { method: "PATCH", body: JSON.stringify({ aiSetup: true }) })
      .catch(() => {});
  };
  return (
    <Frame step={step} steps={["ai", "ready"]}>
      {step === "ai" ? (
        <AiStep onContinue={() => setStep("ready")} onSkip={finish} />
      ) : (
        <ReadyStep onDone={finish} />
      )}
    </Frame>
  );
}

mountIsland(
  "onboarding",
  () => ensureContainer("bd-onboarding-root"),
  () => (platform.kind === "web" ? <WebOnboarding /> : <DesktopOnboarding />),
);
