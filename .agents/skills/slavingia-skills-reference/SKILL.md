---
name: slavingia-skills-reference
description: Explore and apply the repo-local slavingia skill library as product and business workflow reference material. Use when the user wants to inspect, compare, adapt, or discuss Sahil Lavingia style SKILL.md workflows in Openwork.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# Slavingia Skills Reference

Use this skill to inspect and reason about the repo-local copy of `slavingia/skills`.

## Scope

This is a reference skill, not a runtime integration.

Use it when the user wants to:

- study how `slavingia/skills` structures `SKILL.md`
- compare business/product coaching skills against Openwork's future skill model
- adapt or port one of those skills into Openwork-friendly form
- discuss what should stay raw skill content versus become an extension or tool

## Reference Paths

Read only the relevant files under:

- `../../references/skill-libraries/slavingia-skills/README.md`
- `../../references/skill-libraries/slavingia-skills/skills/*/SKILL.md`

## Working Rules

1. Treat these files as imported reference content, not as already-supported Openwork runtime skills.
2. Focus on:
   - trigger language
   - workflow structure
   - decision framing
   - portability into assistant-core
3. If the user asks to "bring one into Openwork", separate:
   - raw skill content
   - host assumptions
   - possible extension/tool/page needs

## Deliverable Style

Prefer concise output:

- what this skill is trying to do
- what part is portable
- what part is host-coupled
- whether it should remain a skill, become an extension, or both
