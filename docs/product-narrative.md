# Openwork Product Narrative

## One Sentence

`Openwork` is a harness-first software agent for non-programmers.

It helps people delegate software work without accepting the black-box, unsafe, hard-to-recover experience common in most coding-agent products.

## Product

Openwork is not a chat app with tools.

It is a controlled execution system where a user can hand off software work, watch progress, approve risky actions, inspect outputs, and recover when the agent is wrong.

If this product works, a non-programmer no longer needs to choose between:

- getting blocked by technical work
- or surrendering control to an unsafe autonomous agent

## User

The primary user is a non-programmer who still needs software work done.

Typical examples:

- founders
- operators
- designers
- researchers
- domain experts

They do not want to become developers.
They want a reliable way to get software tasks completed while still understanding what the system is doing and retaining the right to intervene.

## Pain

Most coding-agent products currently fail these users in one of two ways:

1. They are powerful but opaque.
   The agent starts acting, but the user cannot tell what is happening, what is safe, what is pending, or how to take control back.
2. They are safe but weak.
   The product falls back to being a chat box, a form filler, or a toy workflow builder that cannot carry real software work.

Openwork exists to close that gap.

## Non-Goals

Openwork is not:

- an unsafe open-ended agent shell
- a launcher-first novelty app
- an extension marketplace before the core workflow is proven
- an ACP-first platform
- a decorative desktop pet product

The product may eventually expose protocol adapters, skills, extensions, or ambient UI surfaces, but those are not the core thesis.

## Hero Workflow

The hero workflow is:

1. A user states a concrete software goal.
2. Openwork turns that request into a controlled unit of work.
3. The agent plans and executes.
4. Dangerous or ambiguous steps stop for approval.
5. The user can always see what is happening, what artifacts were created, and what decision is required next.
6. The run finishes with understandable results and a persistent record that can be reviewed, resumed, or rerun.

If a new feature does not strengthen this loop, it is either a distraction or a later-phase concern.

## Must-Own Seam

The product does not win by owning model access.

The product wins by owning the seam between:

- agent execution
- harness control
- human judgment

Openwork must translate low-level agent behavior into a control surface that a non-programmer can use.

That means the system must make these things legible:

- what the agent is trying to do
- what it has already done
- what changed
- what needs approval
- how to interrupt, recover, or retry

## Harness Surface

Harness is not internal plumbing.
It is part of the user-facing product.

Users should feel the harness through:

- a plan, not just a stream of text
- explicit approval points, not silent escalation
- visible artifacts, not only raw diffs
- persistent run history, not disposable chat
- recovery and replay, not "start over from scratch"

Whenever product decisions are ambiguous, prefer the path that increases controllability, inspectability, and recoverability.

## Product Boundaries

### Launcher

The launcher is the default entry and recovery surface.

It owns:

- starting a task
- framing the current session
- letting the user return to work already in progress

It does not own the long-running truth of a run.

### Agent Runtime

The runtime owns:

- planning
- tool use
- execution
- approvals
- completion state

It is the source of truth for run lifecycle.

### Harness

The harness owns the evidence trail of each run.

At minimum, this means:

- intent
- environment
- execution events
- approvals
- artifacts
- outputs
- checkpoints
- replay or recovery semantics

### Sentinel

An ambient surface such as a notch indicator, tray presence, or launcher sentinel is a trust surface.

Its job is to answer:

- is the agent working
- is it producing output
- is it waiting for me
- is it done

It is not the product core.
It exists to keep the user oriented when the main launcher is hidden.

### Skills

Skills are cognitive resources for the assistant.

They are not the product.
They should improve execution quality, not define the primary user experience.

### ACP

ACP is an adapter question, not a core product question.

If Openwork later needs to plug its runtime into external hosts, ACP may matter.
It should not shape V1 architecture or distract from the harness-first workflow.

## Hard Product Decisions

The following decisions are fixed unless a stronger thesis replaces them:

1. `Openwork` is for non-programmers first.
2. Safety means explicit control, not vague reassurance.
3. Harness capability is part of the product, not a hidden implementation detail.
4. Ambient UI exists to expose run state, not to become a second product.
5. Platform ambitions stay subordinate to the hero workflow.

## Decision Filter

Before shipping a feature, ask:

1. Does this make the controlled unit of work clearer?
2. Does this increase user control at the right moment?
3. Does this help a non-programmer judge progress or risk?
4. Does this strengthen the harness, or merely add surface area?
5. If this works perfectly, does it improve the hero workflow?

If the answer to most of these is `no`, cut it or delay it.

## What To Avoid

Common failure modes to reject:

- mistaking "more autonomy" for product progress
- building protocol or platform abstractions before the core loop is trustworthy
- letting the runtime dictate the product boundary
- over-investing in launcher cosmetics while the execution model stays vague
- treating approvals as friction instead of core trust infrastructure
- shipping hidden background behavior without a visible status surface

## Current Product Direction

The current direction is:

`Build a safe, controllable software agent for non-programmers, where every run becomes an inspectable unit of work and the user never loses the ability to understand or intervene.`

That sentence should be the reference point for future product and architecture decisions.

## Companion Docs

For implementation guardrails that support this narrative, also read:

- [engineering-boundaries.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/engineering-boundaries.md)
- [runtime-invariants.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/runtime-invariants.md)
