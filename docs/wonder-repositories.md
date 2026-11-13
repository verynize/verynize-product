# Wonder public repository evidence

Inspected 2026-10-28 via GitHub API (`gh api orgs/aquila-lab/repos?per_page=100`, repository READMEs, manifests and plugin tree). These are public source observations, not installed-app runtime verification.

| Repository                                                                 | License reported by GitHub          | Status and useful evidence                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [wonder-plugins](https://github.com/aquila-lab/wonder-plugins)             | MIT                                 | Active; agent integration manifests and instructions, not desktop/editor source. Default branch `master`.                                                                                                  |
| [wonder-sources](https://github.com/aquila-lab/wonder-sources)             | No repository-wide license detected | Active; corresponding source of third-party binary dependencies. README currently lists bundled Git/dugite-native v2.53.0-4, not Wonder application source. Individual archives carry component licensing. |
| [wonder-bookshelf-app](https://github.com/aquila-lab/wonder-bookshelf-app) | MIT                                 | Active; explicitly an onboarding-only sample, not the Wonder application. React 19.2, Vite 7.1, TypeScript 5.9; Vitest and Testing Library.                                                                |
| [superflex-vscode](https://github.com/aquila-lab/superflex-vscode)         | MPL-2.0                             | Archived; historical AI frontend VS Code extension. Potential workflow reference, not evidence of current Wonder code.                                                                                     |
| [superflex-dashboard](https://github.com/aquila-lab/superflex-dashboard)   | MPL-2.0                             | Archived; historical dashboard.                                                                                                                                                                            |
| [pixijs-layout](https://github.com/aquila-lab/pixijs-layout)               | MIT                                 | Archived Yoga/PixiJS layout fork. A candidate historical rendering dependency, not proof of current use.                                                                                                   |
| [pixijs](https://github.com/aquila-lab/pixijs)                             | MIT                                 | Archived renderer fork. Same limitation.                                                                                                                                                                   |

## Architecture established by public integration documentation

The [plugin README](https://github.com/aquila-lab/wonder-plugins/blob/master/README.md) describes designs as real HTML and CSS. Its remote MCP service can inspect designs, components, variables, and documentation, and create/edit screens and flows. The server runs canvas tools without the desktop app being open, synchronizing edits live when open. OAuth is used rather than user-supplied API keys. These are vendor-documented capabilities; no service execution was performed in this investigation.

The [bundled skill](https://github.com/aquila-lab/wonder-plugins/blob/master/plugins/wonder/skills/wonder-design/SKILL.md) names `get_skills`, `list_files`, and `open_file`; it says `open_file` returns a page without opening a window. The repository does not expose the editor implementation or complete tool schemas. Its small public API surface should inform reconstruction acceptance tests, not be mistaken for a reusable editor engine.

The corresponding-source README provides a useful installed-artifact join: `Resources/git/bundle.json` contains `sourceUrl` pointing to the matching immutable source release. Checking that file can establish the bundled Git revision. It cannot establish editor feature parity.

## Reuse and reconstruction implications

- MIT repositories are available for reuse subject to their actual license notices. Preserve applicable notices when copying code.
- MPL-2.0 historical sources require file-level license handling; a fresh implementation can instead reference behavior.
- No complete public Wonder editor source was found among the seven returned organization repositories. This is a bounded inventory observation, not proof none exists elsewhere.
- Separate local canvas/document behavior from desktop filesystem/Git integrations and remote collaboration/agent services. A browser-only mock cannot claim the latter without implementation and tests.

## Context7 documentation consulted

Resolved Cloudflare Workers and selected `/cloudflare/workers-sdk` (official source, high reputation). Queried static-asset SPA serving for a Vite build. Retrieved official SDK source establishes `not_found_handling: "single-page-application"` serves `/index.html` with status 200 for unmatched assets. Workers can serve frontend assets alongside API code; API paths can run the Worker first.

Sources: [Workers static-assets routing](https://developers.cloudflare.com/workers/static-assets/routing/#routing-configuration), [official asset handler](https://github.com/cloudflare/workers-sdk/blob/main/packages/workers-shared/asset-worker/src/handler.ts), [official Vite SPA/API example](https://github.com/cloudflare/workers-sdk/blob/main/packages/vite-plugin-cloudflare/playground/spa-with-api/vite.config.static-routing.ts).

This supports a Cloudflare-hosted reconstruction architecture, but does not establish Wonder uses Cloudflare. No deployment or cloud-account mutation was performed.
