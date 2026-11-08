// The web app's sign-in screen (web-start/src/routes/_editor.tsx renders it before the editor boots when this browser
// has no session for the server; cloud/README.md "Web sign-in"). It is the desktop onboarding's account form
// (account-step.tsx) bound to this server (lib/web-session.ts), without the server field or a skip, plus a passkey
// option. The address stays as requested, invite fragments (`#room=…&token=…`) included, so the editor opens there
// once signed in. Test contract: `#web-sign-in[data-invite]`, the form ids of account-step.tsx (`#onboarding-email`,
// `#onboarding-password`, `#onboarding-submit`, `#onboarding-mode`, `#onboarding-forgot`, `#onboarding-error`,
// `#onboarding-verify`), `#web-sign-in-passkey`, `#web-sign-in-passkey-error`.
import { useEffect, useRef, useState } from "react";
import { FingerprintIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signInWithPasskey, webAccountApi } from "@/lib/web-session";
import { AccountStep } from "./account-step";

const invited = () => new URLSearchParams(location.hash.slice(1)).has("room");

function PasskeyOption({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);
  const start = async () => {
    run.current?.abort();
    const controller = (run.current = new AbortController());
    setBusy(true);
    setError("");
    try {
      if (await signInWithPasskey(controller.signal)) onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (run.current === controller) setBusy(false);
    }
  };
  return (
    <div className="mt-6 flex w-full flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3 text-xs text-subtle-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        id="web-sign-in-passkey"
        variant="outline"
        className="h-8 w-full"
        disabled={busy}
        onClick={() => void start()}
      >
        {busy ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : (
          <FingerprintIcon className="size-3.5" />
        )}
        {busy ? "Waiting for your passkey…" : "Sign in with a passkey"}
      </Button>
      {error ? (
        <p id="web-sign-in-passkey-error" role="alert" className="m-0 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function WebSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const invite = invited();
  return (
    <div
      id="web-sign-in"
      data-invite={invite ? "true" : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to Verynize"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background text-foreground"
    >
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <AccountStep
          api={webAccountApi}
          serverEditable={false}
          skippable={false}
          onDone={onSignedIn}
          intro={
            invite
              ? "Sign in to open the design you were invited to. Your invite link is kept."
              : "Sign in to open your files, shared rooms and AI chat."
          }
          footer={<PasskeyOption onSignedIn={onSignedIn} />}
        />
      </div>
    </div>
  );
}
