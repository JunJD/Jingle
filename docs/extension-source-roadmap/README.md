# Extension Source Roadmap

This folder tracks the product and engineering plan for making Openwork extensions available to the agent as first-class work sources.

The goal is not to copy Craft Agents directly. The goal is to translate the useful Source idea into Openwork's existing shape:

- Openwork is assistant-first.
- Extensions are capability packages.
- Human commands and agent tools should share common execution logic.
- Agent source usage must enter the harness: approvals, persistence, recovery, and evidence.
- Permission Mode should be a product primitive, not just a tool implementation detail.

## Documents

- [architecture.md](./architecture.md): concept model and boundaries.
- [craft-comparison.md](./craft-comparison.md): architecture diagram and comparison with Craft Agents OSS.
- [start-here.md](./start-here.md): first implementation slice and PR order.
- [roadmap.md](./roadmap.md): phased implementation plan.
- [task-breakdown.md](./task-breakdown.md): concrete task checklist.
- [research-notes.md](./research-notes.md): supporting research from Craft Agents, MCP, and current Openwork code.

## Core Decision

Treat Source as an agent-facing projection of extension capability, not as an extension child object and not as a synonym for MCP.

```txt
Extension
  owns human commands
  owns common tools
  owns optional source definitions
  owns auth/preferences/UI

SourceDefinition
  describes how this extension can appear to the agent as a work source

SourceProfile
  is a configured user/workspace connection for one source definition

RunSourceBinding
  is the per-run evidence snapshot of which source profile was used
```

Permission Mode should apply consistently across shell commands, file mutation tools, extension tools, and future generated MCP/API tools:

```txt
Explore
  read-only; write/external actions are blocked or require changing mode

Ask to Edit
  read actions are allowed; write/external actions require HITL approval

Auto
  trusted write/external actions may run without approval, still inside guardrails
```

## First Vertical Slice

Do not begin with a generic Source platform. Begin with two real sources:

1. Apple Reminders validates read/write tools and approval.
2. GitHub validates real work-agent value with read-only work context.

If both work cleanly, MCP/API/local-folder generalization becomes an extension of a proven path instead of an abstract platform bet.

## Current Scope

In scope now:

- unified Permission Mode
- Source Guide as part of SourceDefinition
- extension common tools
- source middleware
- Apple Reminders and GitHub vertical slices

Deferred:

- agent-guided source setup
- inbox/work queue
- source-triggered automations
- generic MCP/API/local source platform
- Skill `requiredSources`, except as a later concept validation
