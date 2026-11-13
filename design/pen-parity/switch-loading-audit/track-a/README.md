# Track A — loading visuals

Captured by `node tests/switch-loading-visuals.cjs` in real Electron with a new temporary profile and the built-in sample document, copied as Sample A / Sample B. No real account or profile was used. The screenshot-only style hides the anonymous presence avatar. Screenshots show contract events dispatched by the test; Track B's producer is not present in this worktree.

- `file-before.png`: normal workspace before file begin.
- `file-after.png`: file begin; blank canvas-theme surface with centered existing LogoIcon.
- `page-before.png`: outgoing sample page before page begin.
- `page-after.png`: same live page with 16 CSS px Gaussian blur; surrounding panels remain sharp.
- `file-light-after.png`, `page-light-after.png`: light-theme loading states (page capture also uses reduced motion).

Visuals wait 120 ms by default (`verynize.switchLoading.delay` overrides this), fade out over 100 ms, and clear after a 30-second safety timeout. Interaction is blocked from begin, including the delay interval. Ready/end/fail/cancel only release the matching token. Home and Code navigation clean up immediately. The coordinator remains responsible for preserving outgoing DOM and committing the target before ready.

Validation passed: build:ui, lint:ui, typecheck:ui, check, switch-loading-visuals.cjs, file-tabs.cjs, cloud-pages-desktop.mjs. Electron suites ran sequentially.

Initial environment failures were resolved by `npm ci`: `spawnSync .../node_modules/.bin/vp ENOENT` and `Cannot find module '.../node_modules/@playwright/test'`. The first visual test reported `rgb(236, 236, 236)` vs `rgb(245, 243, 238)` because it compared the theme surface with the document's custom page background; its expectation now checks the canvas theme token as required. Final validation has no failures. The build retains its existing warning: `x.png referenced in x.png didn't resolve at build time`.
