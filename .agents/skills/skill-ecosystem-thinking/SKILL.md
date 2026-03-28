---
name: skill-ecosystem-thinking
description: Analyze skill systems, skill libraries, extension boundaries, assistant-core integration, and compiler-for-skills ideas for Openwork. Use when discussing SKILL.md ecosystems, third-party skills, skill vs extension modeling, assistant skill loading, or product strategy around agent capabilities.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# Skill Ecosystem Thinking

Use this skill when the user is shaping Openwork's skill system, extension model, assistant-core capability model, or wants to draw lessons from external skill libraries.

## Goal

Reduce concept confusion across these layers:

- `skill source`
- `compiled skill`
- `extension`
- `launcher plugin`
- `assistant-core`

Do not collapse them into one abstraction unless the user explicitly wants a simplification tradeoff.

## Repo References

When the discussion involves external skill libraries, inspect only the relevant parts of these repo-local references:

- `../../references/skill-libraries/slavingia-skills/`
- `../../references/skill-libraries/ljg-skills/`

Typical paths:

- `../../references/skill-libraries/slavingia-skills/skills/*/SKILL.md`
- `../../references/skill-libraries/ljg-skills/skills/*/SKILL.md`

## Working Method

1. Name the layer under discussion before proposing architecture.
2. Distinguish:
   - `skill`: agent-facing methodology or workflow content
   - `extension`: integration shell that may provide skills, tools, config, or UI
   - `launcher plugin`: human-facing page/entry surface
3. Check whether the external skill is:
   - pure content
   - content + scripts/assets
   - user-invocable workflow
   - coupled to a specific host like Claude Code
4. Be explicit about what should be:
   - owned by Openwork
   - adapted from third-party skills
   - left as raw reference content

## Product Lens

Prefer this product stance unless the user says otherwise:

- Openwork is `assistant-first`
- `assistant-core` is the main character
- skills are cognitive resources for assistant-core
- extensions are optional integration shells around skills/tools/pages

If a proposed design makes everything equal, call that out as dilution.

## External Library Heuristics

### slavingia-skills

Treat as:

- structured business coaching workflows
- relatively portable skill content
- low host coupling

Useful for:

- skill authoring style
- staged workflow design
- skill compiler indexing

### ljg-skills

Treat as:

- opinionated, high-agency personal workflows
- heavy host coupling in some skills
- examples of large, rich, asset-backed skills

Useful for:

- understanding that some skills are large content systems
- skill packaging with references/assets/scripts
- pressure-testing the boundary between pure skills and extensions

Be careful:

- some paths assume `~/.claude/...`
- some outputs assume local personal directories
- do not treat them as drop-in Openwork runtime skills without adaptation

## Deliverable Style

Prefer short product memos with:

- `What this layer is`
- `What it is not`
- `Why the current confusion happens`
- `Recommended boundary`
- `Next concrete move`

If the user asks for implementation, propose the smallest step that reduces ambiguity.
