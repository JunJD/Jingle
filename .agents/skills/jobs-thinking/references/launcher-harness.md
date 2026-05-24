# Launcher And Harness Lens

Use this reference when the product idea involves an agent launcher, runtime, IDE shell, task runner, or execution harness.

## Define The Boundary First

- `Launcher` owns entry, session framing, task selection, visibility, approvals, and recovery.
- `Agent runtime` owns planning, tool use, code changes, and local execution.
- `Harness engineering` owns the evidence trail: inputs, environment, traces, diffs, artifacts, replay, rollback, and evaluation.

Do not let these layers blur casually. A blurred boundary creates vague products and unstable systems.

## Name The Product Honestly

Force one of these positions:

- The launcher is a thin shell around many interchangeable agents.
- The launcher is the product, and agents are replaceable internals.
- The launcher plus harness is the product, because trust comes from control, replay, and inspectability.

If the answer is unclear, the product thesis is not ready.

## Treat Harness Engineering As Product, Not Only Infra

Git gives version history, diff, and rollback. That is valuable, but it is not the whole harness.

A real harness for agent work usually needs:

- task input capture
- environment capture
- step trace or event log
- code diff and file artifact storage
- test or command outputs
- checkpoints for approval or interruption
- replay or re-run semantics
- evaluation criteria and result records

If users can feel reliability, reversibility, and clarity because of these capabilities, then harness engineering is part of the product experience, not just internal scaffolding.

## Use These Hard Questions

- What is the first-run experience that makes the product feel obviously better?
- After one task completes, what artifact remains that a user can inspect, compare, or replay?
- What happens when the agent is wrong? Where does the user regain control?
- What can be reproduced exactly, and what remains best effort?
- Which part of trust comes from the launcher, and which part comes from the harness?
- If openclaw cannot support harness engineering well, are we trying to fix openclaw, or are we building a launcher-first system that makes harness native?

## Recommended Product Direction For This Theme

When the concept is "openclaw direction, but with harness engineering," pressure-test this thesis:

`Build a launcher-first agent system where every run becomes a controlled, inspectable unit of work with plan, permissions, artifacts, diff, replay, and evaluation.`

That thesis is stronger than:

- "Build an open agent platform"
- "Build a launcher for many models"
- "Add better tooling around agents"

Those are categories. The thesis above is a product.

## Reject These Anti-Patterns

- Using openness as an excuse to avoid a sharp default workflow
- Treating harness features as optional expert tools hidden behind debug screens
- Shipping many provider integrations before proving one excellent end-to-end loop
- Equating repository git history with full execution accountability
- Letting the runtime dictate the product instead of the product dictating the runtime boundary

## End With A Memo

When using this lens, end with:

```text
Product:
Hero workflow:
Must-own seam:
Harness surface the user can feel:
What to cut now:
Next experiment:
```
