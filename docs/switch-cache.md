# Switch coordination and presentation cache

`switch-coordinator.js` owns token lifetimes. A new begin cancels the previous token;
completion from an older operation cannot dismiss the new operation. `document-will-change`
remains the disconnect boundary after the outgoing flush. Timing values in `getState().marks`
use `performance.now()`; `cachePaint` follows rAF and a timer, while `fresh` follows rendering.

The bounded room cache contains confirmed documents only, keyed by account, server origin,
and room id (no credentials). It does not own local files or outboxes. Entries with pending
or deferred work are pinned; the eight-entry/64 MiB eviction budget applies to disposable
entries. Account changes and revocation purge presentations. No DOM cache is retained.

`presentDocument` temporarily renders a separate document and restores the model reference
without notifying subscribers, taking history checkpoints, or scheduling persistence. It
never supplies a baseline to cloud diffing. The outgoing flush runs before presentation.
HTTP finishes before the new socket is opened, so HTTP cannot overwrite newer socket state;
ordered snapshot/ops processing, batch identities, ack pruning, and deferred page operations
remain owned by the cloud client. A warm protocol-2 open waits for socket hydration before
reporting fresh completion. Offline recovery continues to use the existing durable outbox.

Lazy pages retain the outgoing canvas DOM, but **do not defer activePage in the model**.
The latter would redirect programmatic edits to the outgoing page and break deferred edits,
page removal, and collaborative undo. Canvas rendering and afterRender are skipped until
the target is loaded; page-loading keeps its existing status and offline text. The workspace
is inert during this interval. Loaded page switches remain synchronous. This is a renderer
handoff, not a parked DOM cache; the next render reconciles against current authoritative data.

Library document objects are replaced when synchronized content changes. A WeakSet marks
normalized internal objects, allowing library reopen to skip repeated safety validation.
External inputs still go through documentSafety. Each active document gets its own clone;
mutable models never alias the library. The library subscriber avoids cloning during a load
whose saving guard would discard the result. Native tabs still use detached library copies;
this change does not provide native disk freshness.

The hosted-web script manifest is generated from `web/index.html` by
`web-start/build/legacy-web.mjs`, so the new script order applies to both hosts.
Two existing island subscribers still stringify the document on render. This track avoids
library synchronization serialization and redundant validation; it does not eliminate all
renderer serialization, and mutable document isolation still requires cloning.

## Validation (2026-11-06)

Built UI with `npm run build:ui`. `npm run check` and all ten requested test scripts
passed in a sequential run: switch-cache, cloud-switch-cache, file-tabs,
document-lifecycle, cloud-async, cloud-files-desktop, cloud-pages-desktop,
cloud-room-pages, canvas-incremental-render, and wonder-shell. The two new tests and
check passed again after the final cache metadata/diagnostic changes.

Measurements use temporary Electron profiles and a local Miniflare server, with
`performance.now()` in the renderer. The local fixture has two files and two pages;
the room fixture has two clients. These are individual samples, not p50/p95 claims.
Local cold samples clear the disposable validation cache before switching.

| Scenario        | Cold completion | Warm cache paint   | Warm completion |
| --------------- | --------------- | ------------------ | --------------- |
| Local files A/B | 4.8 / 4.8 ms    | synchronous render | 3.1 / 2.5 ms    |
| Miniflare room  | 112.0 / 52.9 ms | 2.8 ms             | 30.8 ms         |

Warm room marks relative to begin: outgoing flush 0.2 ms, provisional DOM 0.7 ms,
paint opportunity 2.8 ms, fresh DOM 30.8 ms. Frame timing is measured at rAF plus a
macrotask, not by a compositor/pixel probe. Room cold samples are separate clients;
local measurements are too small to establish a general performance improvement.

Failures encountered and resolved during development:

- Initial build: `spawnSync .../node_modules/.bin/vp ENOENT`; dependencies were absent.
  Installed with `npm ci`, then built successfully.
- `wonder-shell.cjs`: `locator.click: Timeout 30000ms exceeded`, waiting for
  `#library-new-file` (`element is not visible`). Clean staging passed, and subsequent
  worktree runs passed unchanged; no assertion was loosened.
- A home-navigation regression reported `Cannot read properties of null (reading
  'phase')`. The coordinator now checks that state exists before matching a token.
- The new restart test initially reported `page.waitForFunction: Timeout 20000ms
  exceeded`. Its asynchronous outbox predicate did not establish durable persistence;
  the test now explicitly awaits a stored batch containing the pending operation
  before exiting Electron. It then verifies convergence after restart.

The restart investigation also removed ordinary stale-library diffing during room
restore: only explicit detached-copy/overflow recovery retains that fallback.
Tests verify that presentation does not mutate the model or notify subscribers,
file/page event order, same-file no-op, supersession, LRU entry bounds, cache-hit
library serialization, inactive-room/page remote updates, concurrent same-property
convergence, and durable pending operations surviving eviction and restart.

The additional `document-validation-safety.cjs` gate also passed (repair, corruption
retention across restart, invalid library records, and refused native inputs).
Active documents live outside the inactive-room LRU; a consumed presentation entry
is removed when its room becomes active. Eviction therefore cannot evict active
model state or durable pending operations.

A subsequent cloud rerun after active-entry eviction passed: cold 79.6 / 57.9 ms,
cache paint 3.0 ms, fresh completion 48.6 ms. This variation reinforces that the
reported samples are illustrative rather than stable latency percentiles.
