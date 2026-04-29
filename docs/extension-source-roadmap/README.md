# Extension Source Roadmap

This folder tracks the product and engineering plan for making Openwork extensions available to the agent as first-class work sources.

The goal is not to copy Craft Agents directly. The goal is to translate the useful Source idea into Openwork's existing shape:

- Openwork is assistant-first.
- Extensions are capability packages.
- Human commands and agent tools should share common execution logic.
- Agent source usage must enter the harness: approvals, persistence, recovery, and evidence.

## Documents

- [architecture.md](./architecture.md): concept model and boundaries.
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

## First Vertical Slice

Do not begin with a generic Source platform. Begin with two real sources:

1. Apple Reminders validates read/write tools and approval.
2. GitHub validates real work-agent value with read-only work context.

If both work cleanly, MCP/API/local-folder generalization becomes an extension of a proven path instead of an abstract platform bet.
