# External research — 2026-10-29

Evidence: official documentation and repository descriptions, not a hands-on visual quality benchmark. No claim of measured taste parity. Agent-reach Exa route attempted; mcporter unavailable, so built-in web search/open used. Context7 successfully resolved and queried Claude Agent SDK.

## Wonder (primary comparator)

https://wonder.design/docs/ideate-on-the-canvas
Official workflow: provide surface, intent, constraints, selected frames/reference images; explore multiple directions side by side; refine chosen direction; generated objects remain editable. Implication: benchmark both first generation and iterative refinement, and supply identical reference context to all tools. This documentation describes a supported workflow, not evidence of consistently superior taste.

https://wonder.design/docs/design-is-code
Official positioning: actual repository components/tokens/icons/screens on canvas, GitHub pull/push integration. Implication: grounded component reuse and export fidelity matter as much as visual polish. Treat zero-drift wording as vendor positioning until round-trip tests establish fidelity.

## Pen / Pencil (primary comparator)

https://docs.pencil.dev/getting-started/create-your-first-design
The docs at pencil.dev now brand the product pen.dev. Selection context and granular editable tool changes documented. Installed application identity/version is independently audited by other agent.

https://docs.pencil.dev/core-concepts/ai-agents
Official docs explicitly distinguish skills (instructions) from MCP tools (document reads/writes). External clients should call read_skill then referenced files. Context includes selections and attached images/text. Parallel modes: Split Work versus Side by Side; successive variants distinguish Layout preserving style versus Style exploration. Implication: use typed orchestration modes and explicit exploration axes, rather than repeatedly regenerate the whole screen. These are documented capabilities, not inferred internal prompts.

https://docs.pencil.dev/core-concepts/design-libraries
Reusable components and variables import through libraries; instance overrides preserved. Cross-document copies carry variables/themes; fonts and images require availability checks. Implication: asset/font readiness and real library bindings belong in generation preflight and render acceptance criteria.

## Figma (secondary comparator)

https://developers.figma.com/docs/figma-mcp-server/mcp-vs-agent/
Figma explicitly states MCP provides structured context; the agent writes the final code and only knows conventions supplied through variables, Code Connect, rules, prompts. Therefore the user's hallucination experience cannot establish that Figma itself is the root cause: evaluate what exact context/tools/model were used.
https://developers.figma.com/docs/figma-mcp-server/
Current official MCP supports native canvas writes as well as reads. Do not evaluate it as read-only based on older docs. Grounding should include actual frame hierarchy, variables, component identities and screenshot; a bare Figma URL is insufficient if the integration never resolves it.

## FigCraft by ArtCraft (confirmed identity; secondary architectural reference)

https://getartcraft.com/ links FigCraft among Crafting Apps separately from the image/video ArtCraft Studio.
https://github.com/storytold/figcraft links back to getartcraft.com/apps/figcraft. Official repository describes Rust native interface design with frames, auto layout, components/variants, variables and prototypes. It states UI, CLI, JSON channel and MCP share a command engine; included examples were authored via command API and exported by its renderer. This is a particularly useful reproducibility pattern: document fixtures + commands + rendered exports. No measured speed or quality claims verified here; don't use community figcraft.run/figcraft.net/artcraft.tips as primary sources.

## Context7 findings relevant to Verynize

package.json uses @anthropic-ai/claude-agent-sdk ^0.3.312.
Resolved Claude Agent SDK to /websites/code_claude_en_agent-sdk (official documentation, High reputation). Queried TypeScript tool validation hooks.
https://code.claude.com/docs/en/agent-sdk/hooks
Official docs support PreToolUse hooks with tool matcher, permissionDecision and updatedInput, plus PostToolUse additionalContext / updatedToolOutput. Recommendation (our inference): put deterministic scene operation validation before mutations, return machine-readable findings after render/tool completion, enforce final screenshot/revision acceptance in application runtime. Hooks are plumbing, not a taste evaluator, and one provider's SDK hooks do not automatically cover Codex or other backends; application-level validation should be canonical.

## Proposed fair quality benchmark (recommendation, not measured result)

Freeze 8 briefs across dashboard, editorial landing, mobile onboarding, commerce, settings, data-dense table, reference reconstruction and existing-screen refinement. Same prompt/reference/assets/fonts/viewports; record provider/model, effort, time and token/cost budget. At least 3 trials per brief; blind rank Verynize vs Wonder and Pen separately. Score hierarchy/typography/spacing/color/content relevance/asset relevance and functional fidelity. Gate missing assets, overlap, clipped text, unauthorized content changes, invalid components and export drift separately from subjective taste. Report win/tie/loss and distribution, not a fabricated '1:1' percentage. For faithful recreation, use identical viewport/font loading and screenshot geometry comparisons; for original design, pixel equality is not a quality measure.

Priorities: curated reference/style evidence + real token/component context; explicit brief/art-direction decision; incremental validated scene operations; actual renderer screenshot critique/repair with bounded retries; version-linked acceptance; reusable fixture corpus and blind comparisons. Multi-agent count alone does not establish quality.
