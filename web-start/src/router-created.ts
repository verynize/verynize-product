// Lets browser-only code see the router without router.tsx importing it (router.tsx also runs on the server, and the
// crash-report SDK must stay out of the server bundle). client.tsx's telemetry listens; getRouter() announces.
import type { AnyRouter } from "@tanstack/react-router";

const listeners = new Set<(router: AnyRouter) => void>();
let created: AnyRouter | undefined;

export function onRouterCreated(listener: (router: AnyRouter) => void) {
  listeners.add(listener);
  if (created) listener(created);
}

export function routerCreated(router: AnyRouter) {
  created = router;
  for (const listener of listeners) listener(router);
}
