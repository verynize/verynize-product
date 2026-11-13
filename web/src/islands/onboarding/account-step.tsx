// First-run account step: sign in or create a Verynize cloud account (email + password through
// window.cloudAccount, the same session the Share panel uses). Skippable on the desktop: the editor
// is local-first. The web app's sign-in screen (web-sign-in.tsx) renders the same form before the
// editor boots, bound to its own server (lib/web-session.ts), without the server field or a skip.
import { useState, type FormEvent, type ReactNode } from "react";
import { LoaderCircleIcon, MailCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoIcon } from "@/components/icons";
import { cloudAccount } from "@/lib/cloud-account";

type Mode = "signin" | "signup" | "verify";

/** What the form needs from an account store: window.cloudAccount, or the web app's (lib/web-session.ts). */
export type AccountFormApi = {
  defaultServer(): string;
  signIn(o: { server: string; email: string; password: string }): Promise<unknown>;
  signUp(o: { server: string; email: string; password: string; name?: string }): Promise<void>;
  forgotPassword(o: { server: string; email: string }): Promise<void>;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AccountStep({
  onDone,
  api = cloudAccount(),
  serverEditable = true,
  skippable = true,
  intro = "Share designs, edit together and work in team workspaces. Everything else works offline too.",
  footer,
}: {
  onDone: () => void;
  api?: AccountFormApi | null;
  /** Show the server and let the user change it (desktop). */
  serverEditable?: boolean;
  /** Offer "Continue without an account" (desktop). */
  skippable?: boolean;
  intro?: string;
  /** Extra sign-in options under the form (the web app's passkey button). */
  footer?: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [server, setServer] = useState(() => api?.defaultServer() ?? "");
  const [editingServer, setEditingServer] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const origin = () => {
    const url = new URL(server.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw Error("Use an HTTP or HTTPS server URL");
    return url.origin;
  };
  const run = async (task: () => Promise<void>) => {
    if (!api) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (mode === "signup") {
        await api!.signUp({ server: origin(), email: email.trim(), password, name: name.trim() });
        setPassword("");
        setMode("verify");
      } else {
        await api!.signIn({ server: origin(), email: email.trim(), password });
        setPassword("");
        onDone();
      }
    });
  };
  const forgot = () =>
    void run(async () => {
      if (!email.trim()) throw Error("Enter your email address first");
      await api!.forgotPassword({ server: origin(), email: email.trim() });
      setNote(`If ${email.trim()} has an account, a reset link is on its way.`);
    });

  if (mode === "verify")
    return (
      <div
        className="flex w-full max-w-sm flex-col items-center text-center"
        id="onboarding-verify"
      >
        <MailCheckIcon className="size-8 text-primary-text" />
        <h1 className="mt-5 text-xl font-medium text-foreground">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a verification link to {email.trim()}. Open it, then come back and sign in with
          your password.
        </p>
        <Button id="onboarding-verified" className="mt-8" onClick={() => setMode("signin")}>
          I verified my email
        </Button>
      </div>
    );

  const signup = mode === "signup";
  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <LogoIcon className="size-8 text-foreground" />
      <h1 className="mt-5 text-xl font-medium text-foreground">
        {signup ? "Create your Verynize account" : "Sign in to Verynize"}
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">{intro}</p>

      <form id="onboarding-form" className="mt-8 flex w-full flex-col gap-3" onSubmit={submit}>
        {signup ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="onboarding-name" className="m-0 text-xs text-muted-foreground">
              Name
            </label>
            <Input
              id="onboarding-name"
              className="h-8"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="onboarding-email" className="m-0 text-xs text-muted-foreground">
            Email
          </label>
          <Input
            id="onboarding-email"
            className="h-8"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="onboarding-password" className="m-0 text-xs text-muted-foreground">
            Password
          </label>
          <Input
            id="onboarding-password"
            className="h-8"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 10 : undefined}
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? (
          <p id="onboarding-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {note ? (
          <p role="status" className="text-xs text-muted-foreground">
            {note}
          </p>
        ) : null}
        <Button id="onboarding-submit" type="submit" className="mt-2 h-8" disabled={busy}>
          {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
          {signup ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className="mt-4 flex w-full items-center justify-between text-xs">
        <button
          id="onboarding-mode"
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setMode(signup ? "signin" : "signup");
            setError("");
            setNote("");
          }}
        >
          {signup ? "I already have an account" : "Create an account"}
        </button>
        {!signup ? (
          <button
            id="onboarding-forgot"
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={forgot}
          >
            Forgot password?
          </button>
        ) : null}
      </div>

      {footer}

      <div className="mt-8 flex w-full flex-col items-center gap-2 text-xs text-subtle-foreground">
        {!serverEditable ? null : editingServer ? (
          <label className="m-0 flex w-full flex-col gap-1.5">
            Server
            <Input
              id="onboarding-server"
              className="h-7"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              onBlur={() => setEditingServer(false)}
              autoFocus
            />
          </label>
        ) : (
          <button
            id="onboarding-server-edit"
            type="button"
            className="hover:text-foreground"
            onClick={() => setEditingServer(true)}
          >
            Server: {server.replace(/^https?:\/\//, "") || "not set"} · Change
          </button>
        )}
        {skippable ? (
          <button
            id="onboarding-skip"
            type="button"
            className="hover:text-foreground"
            onClick={onDone}
          >
            Continue without an account
          </button>
        ) : null}
      </div>
    </div>
  );
}
