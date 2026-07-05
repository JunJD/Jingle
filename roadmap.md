# Jingle Roadmap

[English](roadmap.md) | [简体中文](roadmap.zh-CN.md)

Jingle is a Raycast-class launcher with an inspectable agent runtime.

Raycast is the bar for command discovery, keyboard speed, extension authoring,
per-command preferences, AI commands, AI extensions, agents, skills, and
MCP-style integrations. Jingle should feel just as quick for everyday desktop
work, then go further when an AI agent starts acting on the user's behalf.

The difference is the execution harness. A meaningful agent run should leave
behind more than a chat transcript: inputs, permissions, checkpoints, tool
results, artifacts, diffs, and enough history for the user to understand what
happened.

## Product Principles

- The launcher is the front door. Starting work should stay fast, searchable,
  and keyboard-native.
- The agent runtime owns execution truth: planning, tool use, checkpoints,
  approvals, and resumable work.
- Sessions are work surfaces, not disposable chat tabs. They should be
  addressable, linkable, and able to coordinate when the work is larger than one
  run.
- The renderer projects state; it should not invent runtime facts to hide
  missing contracts.
- Extensions should feel approachable like Raycast extensions while exposing
  tools an agent can call safely.
- Tags, status, source, and assignee are product facts. They should not be
  hidden inside message text.
- Local data belongs to the user. Memory, checkpoints, settings, and workspace
  context should be inspectable and movable.

## Raycast Baseline, Jingle Direction

The baseline is familiar on purpose:

- command search should be instant
- extension commands should be easy to build with React and TypeScript
- preferences, OAuth, storage, menus, and navigation should feel native to the
  host app
- AI commands, AI extension tools, reusable agent instructions, and MCP-style
  integrations should be first-class entry points

Jingle extends that baseline with an execution model for longer-running agent
work. A session should be more than a chat window: it should have durable state,
links to source work, permissions, status, tags, artifacts, diffs, and
observable communication with other sessions.

## 1. Launcher Foundation

Jingle should be good before AI is involved.

Focus areas:

- fast app, command, extension, and thread search
- predictable keyboard navigation
- clear AI entry points from the launcher
- stable window behavior for launcher, settings, and pinned sessions
- native desktop presence for long-running work

Good looks like this: opening the launcher, finding a command, starting an AI
thread, approving a tool, and returning to the same work all feel like one
desktop flow.

## 2. Agent Runtime

Agent work needs durable state and visible control.

Focus areas:

- thread history and resumable runs
- checkpoints that preserve the work state
- approval requests that show what the agent wants to do
- file, shell, and extension tool results with inspectable evidence
- clear separation between core state and derived projections such as search,
  summaries, and display caches

Good looks like this: a user can stop, resume, inspect, and explain an agent run
without depending on hidden process memory or a fragile UI snapshot.

## 3. Work Items, Sessions, And Coordination

Agent work often starts as a sentence, but it quickly becomes a managed piece of
work: a bug, a draft, an investigation, a release task, or a follow-up from an
extension. Jingle needs a work layer above raw chat so sessions can coordinate
without turning the message list into a database.

Focus areas:

- work items with title, body, source, tags, status, priority, assignee, and
  workspace context
- multiple active sessions for the same workspace or goal
- parent-child session relationships for delegated or parallel agent work
- session-to-session communication that preserves sender, recipient, intent,
  and resulting action
- session inbox/outbox views for work requests, handoffs, review notes, and
  blockers
- status lanes such as active, waiting, review, blocked, and done
- tags and labels that can drive search, grouping, routing, and extension
  actions
- extension-defined tag suggestions that become host-owned tags only after
  Jingle accepts them
- durable links between work items, sessions, tool runs, artifacts, diffs,
  external issues, and extension items

Extensions should participate in this layer without owning it. A GitHub issue,
Notion page, Figma file, reminder, or custom extension item should be able to
offer an action such as "Work on this" or "Summarize with Jingle". The extension
provides the source item and suggested action; Jingle creates the work item,
chooses or creates the session, tracks status, and records execution evidence.
Extensions can request work transitions through typed actions and read the
host-owned projection for items they contributed, but they should not write
runtime truth directly.

Good looks like this: a user can see several agent sessions working on related
items, understand which ones are blocked or ready for review, and let
extensions create work without giving extensions direct write access to runtime
truth.

## 4. Extension Platform

Extensions are how Jingle grows beyond the built-in app.

Focus areas:

- public `@jingle/extension-api`, `@jingle/extension-utils`, and
  `@jingle/extension-cli` packages
- extension commands built with React and TypeScript
- preferences, storage, OAuth, menu bar commands, and trust boundaries
- agent-callable extension tools with typed inputs and visible outputs
- migration paths for useful Raycast extension patterns
- extension item actions that create work requests instead of only opening UI
- extension-visible status and tag hooks where the host remains the owner of the
  work state

Good looks like this: an extension author can build a normal command UI and
also expose a tool the agent can use, without reaching into private app APIs.

## 5. Local Memory And Workspace Context

Jingle should remember useful context without taking control away from the user.

Focus areas:

- local-first memory storage
- workspace rules and context sources with visible file paths
- concise context packs for the agent runtime
- clear deletion and editing semantics
- no cloud sync dependency for the local-first product path

Good looks like this: a user can see what Jingle remembers, change it, remove
it, and understand when it is used.

## 6. Public Project Quality

The repository should be understandable to a new contributor.

Focus areas:

- clean README, roadmap, contributing, security, support, and release docs
- MIT license and clear package metadata
- issue templates that ask for useful reproduction context
- PR templates that ask contributors to name the owning layer
- architecture docs for runtime, extension, storage, and renderer boundaries
- repeatable local build, test, and desktop packaging commands

Good looks like this: a stranger can clone the repo, run the app, find the
owning layer for a change, and open a PR with the right checks.

## Naming

The public project name is Jingle. Stable identifiers in code, package names,
schemas, events, tools, and persisted fields should use `jingle`.

## Not In The First Public Cut

- cloud sync for memory
- broad compatibility fallbacks that hide broken contracts
- a marketplace before the extension package contract is stable
- compatibility layers for old project names or protocols
