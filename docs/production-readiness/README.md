# Production Readiness Governance

This folder is the production-release governance entrypoint for Openwork/Jingle.
It records current code-backed facts first, then proposes the smallest cleanup
batches. It is not a replacement for feature docs, help docs, or historical
research notes.

## Boundaries

| Class                    | Owner                                                                                       | Includes                                                                                                               | Does not include                                              |
| ------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Product                  | `src/main`, `src/preload`, `src/renderer/src`, `src/shared`, first-party extension packages | User-visible windows, launcher, agent workflow, settings, extensions, models, memory, logs and diagnostics             | Dev-only scripts, migration experiments, stale research       |
| User                     | `docs/help`                                                                                 | Getting started, concepts, workflows, settings, troubleshooting, FAQ                                                   | Internal architecture debate or implementation handoff detail |
| Dev                      | `docs`, `packages`, `scripts`, `.agents`, `.github`, package scripts                        | Local development, architecture contracts, extension development, debugging, packaging, release, contribution workflow | End-user onboarding copy                                      |
| Test                     | `tests`, package test scripts, guardrail scripts, BDD fixtures                              | BDD, node tests, validation scripts, quality gates, isolated test data                                                 | Manual-only product claims without an observable check        |
| Deprecated or historical | archived docs or local ignored artifacts                                                    | Superseded plans, old migration experiments, documents that explain background only                                    | Current production contracts                                  |

## Phase 1 Outputs

- [Production feature inventory](./production-feature-inventory.md)
- [Documentation audit](./documentation-audit.md)
- [Code classification governance](./code-classification-governance.md)
- [Help center information architecture](./help-center-information-architecture.md)
- [Blog topics and draft outlines](./blog-topics-and-outlines.md)
- [Execution waves](./execution-waves.md)

## Current Release Gate Notes

- The current worktree already contains uncommitted diagnostics-related product
  code changes. This folder treats those files as current evidence, but does not
  alter or restage them.
- Wave 3 fixed the `npm run doctor` path drift by tightening native extension
  directory discovery and extending guardrail coverage across
  `installable-extensions`. Current diagnostics should be treated as real
  dev/test gate output, not stale path noise.
- Root docs are not uniformly current. All production-facing rewrite decisions
  in this folder should be verified against code paths, package scripts, and
  workflow files before being applied.
