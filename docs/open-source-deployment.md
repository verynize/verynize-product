# Open-source deployment boundaries

Publishing source does not grant access to the maintainer's Cloudflare account. Worker names and binding declarations are configuration, not credentials. Never embed API tokens in source, browser bundles, or desktop releases.

## Local deployment (existing supported path)

Use the project-local `cf` and your own Cloudflare authentication profile. Credentials remain outside Git. From the product directory, run `npm ci`, `npm run deploy:check`, then `npm run deploy` after reviewing the build and target account. The last command changes remote infrastructure.

Fork maintainers must authenticate to their own account. If renaming the Worker in `cloudflare.config.ts`, also change the `worker` values on all four Durable Object bindings (`ROOMS`, `ACCOUNTS`, `APPS`, `AI_RUNS`). Do not point local testing at production resources or reuse production design invite links.

The default email transport uses the native `EMAIL` binding. Only deployments selecting the optional webhook transport need `EMAIL_WEBHOOK_URL` and `EMAIL_WEBHOOK_TOKEN`; these are runtime secrets, distinct from the deployment API token. Configure them using Cloudflare secret management. The existing cf CLI also supports `cf deploy --prebuilt --secrets-file /absolute/path/to/private.json`; keep that file outside the checkout, restrict permissions, and never upload it as a build artifact. A secret deployment changes the live service. Never put `CLOUDFLARE_API_TOKEN` in the runtime secrets file.

## Optional GitHub backend deployment

The product repository includes a manual backend workflow (`.github/workflows/deploy.yml`), separate from desktop ALPHA builds. It remains disabled until repository variable `ENABLE_PRODUCTION_DEPLOY` is `true`. Before enabling it:

1. Create GitHub environment `production`, restricted to the `main` branch. Choose an active repository maintainer as required reviewer. CODEOWNERS alone does not enforce review; configure a branch ruleset requiring pull requests and code-owner review for main, including workflow/config changes. Avoid bypasses where possible.
2. Create a dedicated Cloudflare API token scoped to the intended account and only the Workers/resource permissions required by this project. Avoid the global API key. Use a separate Cloudflare account for unrelated critical workloads if account-wide permissions would be too broad.
3. Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as **production environment secrets**, never as public variables. Do not copy credentials to forks. Supply secret values directly through GitHub's secure UI or secret-input tooling, never issue/PR comments.
4. Enable the repository variable and dispatch the workflow on main. It checks the canonical repository and branch, builds without Cloudflare credentials, and exposes credentials only to the deployment step. Review all code and dependencies being deployed: trusted code at that step can still read its environment.

Never add production secrets to pull-request jobs, use `pull_request_target` to execute contributor code, or deploy an untrusted PR artifact. Fork pull requests do not receive ordinary Actions secrets by default; preserve that boundary. Maintainer approval to run CI is not a security review of the code.

The workflow does not provision email secrets, run database migrations, or prove production readiness. It calls `cf deploy` directly and does not run the npm deploy script’s `sentry-release.mjs` step. Existing account access, quotas, abuse controls, email delivery, and authorization must be verified for the hosted service. Source availability does not make its public APIs safe automatically.

## Before claiming a clean release

Scan all three repositories and their Git histories. Revoke any real exposed credential before considering history cleanup. Review screenshots and research exports separately: text secret scanners cannot inspect pixels or determine redistribution rights. Exclude third-party research material from project-license claims until provenance is resolved. Do not rewrite shared history without coordinating with maintainers.

References: [Cloudflare CI](https://developers.cloudflare.com/cf/ci/), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
