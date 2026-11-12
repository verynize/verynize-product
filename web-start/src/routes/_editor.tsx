import { Suspense, lazy, useEffect, useState } from "react";
import { Outlet, createFileRoute, useRouter, useLocation } from "@tanstack/react-router";
import { bootLegacyEditor, bootLegacyHome, scheduleEditorPrefetch } from "../legacy/boot";
import { installShellHost } from "../legacy/shell-host";
import type { WebAccess } from "../legacy/web-auth";

// One client-only host outlives the Files/editor/code/settings routes. Home initializes only
// shared account/library services; routes that need the canvas await the editor phase. Both
// phases use the same DOM and the same hosted Start router. Signed-out users see the gate.
export const Route = createFileRoute("/_editor")({
  ssr: false,
  component: EditorHost,
});

const auth = () => import("../legacy/web-auth");
const WebSignIn = lazy(() => import("@/islands/onboarding/web-sign-in"));

function EditorHost() {
  const router = useRouter();
  const location = useLocation();
  const homeOnly = location.pathname === "/" && !/^#?(room|public)=/.test(location.hash);
  const [access, setAccess] = useState<WebAccess>("checking");
  useEffect(() => {
    let live = true;
    void auth()
      .then(({ webAccess }) => webAccess())
      .then((value) => live && setAccess(value));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.webAuth = access;
    if (access !== "signed-in" && access !== "public") return;
    installShellHost(router);
    const boot = homeOnly ? bootLegacyHome() : bootLegacyEditor();
    let cancelPrefetch: (() => void) | undefined;
    void boot
      .then(() => {
        if (live && homeOnly) cancelPrefetch = scheduleEditorPrefetch();
      })
      .catch(console.error);
    let stop: (() => void) | undefined;
    let live = true;
    void auth().then(({ watchSignOut }) => {
      if (live) stop = watchSignOut();
    });
    return () => {
      live = false;
      stop?.();
      cancelPrefetch?.();
    };
  }, [access, router, homeOnly]);
  if (access === "checking") return null;
  if (access === "signed-out")
    return (
      <Suspense fallback={null}>
        <WebSignIn onSignedIn={() => setAccess("signed-in")} />
      </Suspense>
    );
  return <Outlet />;
}
