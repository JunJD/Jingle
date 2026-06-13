# Execution Waves

This is the proposed second-stage execution plan. Each wave should remain small,
reviewable, and independently commit/PR-friendly.

## Wave 1: Clean Clearly Stale Or Drifting Docs

Scope:

- Rewrite `README.md` release/testing basics to match `package.json` and `.github/workflows`.
- Rewrite `docs/README.md` into current sections: User help, Dev contracts, Release/debugging, Content, Archive/research.
- Mark or move obvious historical docs from the production index.
- Do not edit product runtime code.

Suggested diff range:

- `README.md`
- `docs/README.md`
- optional `docs/archive/**` or index-only changes if movement is too noisy

Validation:

- `rg -n "every branch push|only packages macOS and Windows|src/main/ipc/models.ts|origin/v3.0.0|useAiThread|thread-runtime-adapter" README.md docs/README.md docs`
- Check `.github/workflows/desktop-release.yml` and `package.json` before wording release commands.
- Markdown link check if available; otherwise `rg -n "\\]\\([^)]*\\)"` spot-check touched docs.

Commit/PR:

- Suitable as a standalone docs-only commit/PR.
- Commit message suggestion: `整理生产发布文档入口`

## Wave 2: Add Help Center Basics

Scope:

- Add `docs/help/README.md`.
- Add the first help pages listed in `help-center-information-architecture.md`.
- Cover install/open, first run, model setup, workspace, permission modes, extension overview, logs, FAQ.
- Keep pages user-facing; link to dev docs only for deeper details.

Suggested diff range:

- `docs/help/**`
- `docs/README.md` links to help center if wave 1 already prepared it

Validation:

- Check every important feature in `production-feature-inventory.md` has at least one user doc entry or a planned page.
- `rg -n "migration|Raycast|proposal|roadmap|src/main|tests/node" docs/help` should return only deliberate links, not implementation-heavy prose.
- Optional app smoke for screenshots only if help pages include screenshots.

Commit/PR:

- Suitable as standalone docs PR.
- Commit message suggestion: `补齐帮助中心基础文档`

## Wave 3: Organize Dev/Test Docs And Validation Entrypoints

Scope:

- Write or refresh dev docs for local development, testing matrix, extension development, debugging, packaging/release, and troubleshooting.
- Fix `npm run doctor` drift if the docs intend to list it as a release quality gate.
- Map BDD and node tests to feature families.
- Clarify npm release vs desktop release vs local packaging.

Suggested diff range:

- `docs/dev/**`
- `.agents/skills/launcher-extension-guardrails/scripts/**` for doctor/guardrail discovery drift
- `README.md`, `docs/README.md`, and production-readiness audit docs for links/status updates

Validation:

- `pnpm run doctor`
- `pnpm run check:guardrails`
- Prettier on touched docs/scripts
- Local markdown link check
- Targeted node tests only if product TypeScript or test helpers are touched.

Commit/PR:

- Suitable as a standalone dev-tooling/docs PR because the only code changes are guardrail scripts.
- Commit message suggestions:
  - `修复 extension guardrail doctor 路径漂移`
  - `整理开发测试验证入口`

## Wave 4: Output Blog Drafts

Scope:

- Create blog drafts from `blog-topics-and-outlines.md`.
- Keep launch-facing pieces in content/blog-draft area, not help/dev docs.
- Verify product claims against the feature inventory and current code before writing assertive launch copy.

Suggested diff range:

- `docs/blog-drafts/**`
- optional `docs/launch/**` if consolidating existing launch drafts

Validation:

- `rg -n "will|future|planned|Raycast|marketplace|cloud|sync" docs/blog-drafts` review for accidental overclaiming.
- Cross-check every concrete feature claim against `production-feature-inventory.md`.
- Markdown format and local link checks.

Commit/PR:

- Suitable as standalone content PR.
- Commit message suggestion: `输出生产发布内容草稿`

## Cross-Wave Rules

- Do not mix product runtime refactors with docs cleanup.
- Do not move large directories unless a later wave has a narrow owner and validation reason.
- Keep archive moves mechanical and separate from rewrites.
- When changing docs that mention commands, verify the command exists in `package.json`.
- When changing docs that mention code paths, verify the path exists with `rg --files`.
- When changing docs that mention release behavior, verify `.github/workflows` and package scripts.

## Current Known Follow-Ups

| Follow-up                                   | Wave | Why                                                                                    |
| ------------------------------------------- | ---: | -------------------------------------------------------------------------------------- |
| Rewrite README desktop release section      |    1 | Current README contradicts desktop-release workflow.                                   |
| Re-index docs into current/user/dev/archive |    1 | Current docs index mixes release contracts with research/history.                      |
| Add help center basic pages                 |    2 | User acceptance requires product usage understanding.                                  |
| Add logs/diagnostics help page              |    2 | Current diagnostics code exists but user support docs are missing.                     |
| Guardrail extension-root coverage           |    3 | Done in wave 3; `doctor` and blocking guardrails now include `installable-extensions`. |
| Refresh model provider docs                 |   4+ | README now points users to in-app model list; dedicated model docs still need refresh. |
| Draft launch/blog posts                     |    4 | Done in wave 4 under `docs/blog-drafts`; publication still needs release artifact QA.  |
