# CI

GitHub Actions splits compute jobs between Instabox and Blacksmith, using Ubuntu 24.04 images. Planning, result aggregation, identity, branch policy and production deployment stay on GitHub-hosted runners. Electron tests are Linux-portable (`tests/helpers/keys.cjs`) so CI covers the Linux build, lint and tests. macOS packaging (`npm run package:mac`) and live agent tests stay local.

## Runner allocation

- `quality` and `node + cloud`: `instabox-medium` (4 vCPU, 8 GiB). These jobs build, lint, typecheck and run Node/cloud tests; browser tests install Chromium when selected.
- `electron (i/n)` and `serial`: `blacksmith-4vcpu-ubuntu-2404` (4 vCPU, 16 GB). The additional memory supports Electron, browser processes and the Worker build. Existing system dependency installation and Electron sharding still apply.
- `plan` and the aggregate `tests` job: `ubuntu-24.04`. They do little computation and do not need provider capacity.

Allocation follows the job, not the branch: affected tests and release tests use the same provider for each lane. The branch/event selection below is unchanged. Install each provider's GitHub App with access to this repository before enabling its runner labels. Instabox uses a fresh machine per job and supports `instabox-medium` on its free plan; no Instabox API key is needed for this integration.

At setup, the Instabox free workspace has one machine slot: quality and Node/cloud jobs queue until that slot is free. Blacksmith's monthly free allowance is 3,000 equivalent 2-vCPU Linux minutes, consumed faster by larger runners. Keep Node/cloud on Instabox to reserve Blacksmith credits for the browser-heavy lanes. Check both dashboards for current limits and usage; free access does not mean unlimited capacity.

Runner references: [Instabox CI](https://instabox.sh/docs/ci), [Blacksmith runners](https://docs.blacksmith.sh/blacksmith-runners/overview). Validate the first CI run on both providers before merging; image compatibility alone does not establish that every Electron or cloud test passes.

## Setup performance

Test jobs use a depth-one sparse checkout that excludes `design/` reference screenshots (about 423 MiB at the time of setup). Source, hidden files, docs, eval and test fixtures remain available. PR jobs run `scripts/ci-fetch-history.mjs` to fetch the exact base/head commits with filtered blobs, deepen ancestry until a merge base is available, and fall back to filtered full history for long-lived branches. Fetch credentials are scoped to those git subprocesses and are not stored in repository config. Non-PR full suites need no extra history. The identity workflow retains its full checkout because it inspects historical blobs and images.

The local `setup-node-deps` action restores npm's download cache, including a fallback to compatible caches from previous lockfiles, and installs with `npm ci --prefer-offline --no-audit --no-fund`. Lockfile verification and lifecycle scripts remain enabled; `node_modules` is rebuilt rather than cached. Each job records cache status, versions, elapsed install time and a timing-only artifact, so a slow cold install can be diagnosed without uploading debug logs.

The local `setup-electron-linux` action checks installed system packages and installs only missing ones. It reuses cached package downloads, refreshes Ubuntu package indexes only after an install fails, and retains Inter font aliases and Chromium sandbox setup. Blacksmith Machine Images is still marked **Coming soon** in its dashboard: no custom image is configured. The same setup script supports a future image-bake mode; see [Electron Linux setup](../.github/actions/setup-electron-linux/README.md).

Changes to the test workflow or local setup actions select the full suite. New regression coverage checks sparse checkout contents, PR merge-base correctness and the deep-history fallback with real git repositories.

## Branch flow

```
feature/*  --PR-->  staging  --PR-->  main
```

- Feature branches open PRs into `staging`.
- Only this repository's `staging` branch may open a PR into `main`. `branch-policy.yml` (`staging-promotion`) enforces this. It is a metadata-only `pull_request_target` job and never checks out PR code.
- Production deploys are manual (`deploy.yml`, `workflow_dispatch` on `main`, gated by `vars.ENABLE_PRODUCTION_DEPLOY` and the `production` environment).

## What runs where

| Event                                     | `quality` | `tests`                                    | `identity`           | `staging-promotion` |
| ----------------------------------------- | --------- | ------------------------------------------ | -------------------- | ------------------- |
| PR into `staging`                         | yes       | affected tests only (`base.sha..head.sha`) | yes                  | no                  |
| PR into `main`                            | yes       | full suite                                 | yes                  | yes                 |
| Push to `staging`                         | yes       | full suite                                 | (per `identity.yml`) | no                  |
| Nightly (19:17 UTC, checks out `staging`) | yes       | full suite                                 | no                   | no                  |
| Manual (`workflow_dispatch`)              | yes       | full suite                                 | no                   | no                  |

`tests.yml` jobs:

- `quality`: `npm ci`, `build:ui`, `check`, `lint`, `typecheck:ui`, `typecheck:ratchet`, `format:check` over the whole checked-out tree.
- `plan`: `node scripts/run-tests.mjs --ci-event --list` per lane. It counts the selected tests and builds the Electron shard matrix: about 20 Electron tests per shard, at most 4. The runner imports only Node built-ins, so this job skips `npm ci`.
- `node + cloud`: `--lane node --lane cloud`. No display is needed. Playwright Chromium is installed only when `tests/web-*` is selected.
- `electron (i/n)` (matrix): `--lane electron --shard i/n`. The job installs the Electron system libraries, `xvfb`, Mesa (software WebGL), `zsh` (terminal tests), `poppler-utils` (`pdftoppm`, PDF export check), `fonts-inter` (made fontconfig's `system-ui`/`Sans` font, close to macOS SF metrics, so text-layout tests wrap as on macOS) and a build toolchain for `node-pty`, then downloads the Electron binary (`node node_modules/electron/install.js`). The runner wraps each test in `xvfb-run -a -s "-screen 0 3840x2160x24"` when `DISPLAY` is unset. On Linux CI `desktop/main.cjs` adds `--force-device-scale-factor=2` and overlay scrollbars (macOS geometry), `--disable-gpu` (software compositing) and `--enable-unsafe-swiftshader` (WebGL through SwiftShader). Do not composite through SwiftShader (`--use-angle=swiftshader`): clicks into out-of-process iframes get lost and frames lag.
- `serial`: `--lane serial`, for tests that must run alone (today `integrations/design-files.test.mjs`, whose `fs.watch` wait misses under parallel load). Same system setup as the Electron jobs.
- `tests`: an aggregate job that always runs. It fails if `plan` failed or any lane failed or was cancelled. It passes when lanes were skipped because nothing was affected. Use this stable name as the required check.

Each lane writes `--report $RUNNER_TEMP/report` (`results.json`, `junit.xml`, `summary.md`, plus the job summary). The report is uploaded as a `test-report-*` artifact, kept for 14 days.

The runner builds the Node web bundle once when `web-node`, `web-ai-chat` or `ai-routing` is selected, then shares it across those tests. Direct test invocations still build their own bundle. `--skip-build` skips the UI build only; Node and Worker bundles are still prepared. This removes duplicate builds without skipping browser assertions or increasing browser concurrency.

Install scripts: npm 11 can skip dependency install scripts that `allowScripts` in `package.json` does not list. `workerd`, `node-pty` and `fsevents` are allowed there; Electron has no install script and is downloaded by the explicit step above.

Electron on Ubuntu 24.04: AppArmor blocks unprivileged user namespaces, and npm cannot make `chrome-sandbox` setuid root. Without a fix, the Chromium sandbox aborts. The Electron jobs turn namespaces back on with `sysctl kernel.apparmor_restrict_unprivileged_userns=0` (the VM is thrown away after the job), so tests keep the real sandbox. Only if that fails do they set `ELECTRON_DISABLE_SANDBOX=1`, with a warning.

## Required status checks

Set these in branch protection (or a ruleset):

- `staging`: `quality`, `tests`, `identity`
- `main`: `quality`, `tests`, `identity`, `staging-promotion`

Branch protection on a private repository needs GitHub Pro, Team or Enterprise. The commands below replace the existing protection settings for each branch; review them before you run them:

```sh
REPO=AdamAbd/verynize-product

gh api -X PUT "repos/$REPO/branches/staging/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["quality", "tests", "identity"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON

gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["quality", "tests", "identity", "staging-promotion"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON

# Inspect
gh api "repos/$REPO/branches/main/protection/required_status_checks"
```

To change only the checks and keep the other settings, use `PATCH repos/$REPO/branches/<branch>/protection/required_status_checks` with `{"strict": true, "contexts": [...]}`.

## Setup (one time)

Add the Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) as GitHub Actions secrets in the `production` environment.

Debug a failure: download the `test-report-*` artifact, or reproduce the shard locally (below). Re-run only failed jobs with `gh run rerun <run-id> --failed`.

## Local commands

```sh
npm run test:list-changed   # what CI would select for your branch against staging
npm run test:changed        # run only affected tests
npm test                    # full suite
node scripts/run-tests.mjs --lane electron --shard 1/4   # reproduce one CI shard
```

Before you push, run `npm run lint:ui && npm run typecheck:ui && npm run format:check`.

## Cost

Private repositories get a monthly allowance of GitHub-hosted Linux minutes (2,000 on Free, 3,000 on Pro/Team); beyond that Linux minutes are billed per minute. Standard Linux runners for private repos have 2 vCPU / 7 GB.

- PR into `staging`: quality plus only the affected lanes, usually a few minutes.
- PR into `main`, push to `staging`, nightly: quality, node + cloud, 4 Electron shards and serial run in parallel. Expect the most minutes here; lower the shard count in the `plan` job or drop the push trigger if minutes run short.
- `cancel-in-progress` cancels superseded PR runs, so a burst of pushes does not stack runs.
