// Browser entry (Start's default client entry, plus crash reports). ./telemetry is imported first so an opted-in
// visitor's SDK is running before hydration and before the legacy editor boots.
import "./telemetry";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
