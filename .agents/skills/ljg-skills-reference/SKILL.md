---
name: ljg-skills-reference
description: Explore and apply the repo-local ljg skill library as reference material for large, asset-backed, opinionated skills. Use when the user wants to inspect, compare, adapt, or discuss LJG-style SKILL.md workflows in Openwork.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# LJG Skills Reference

Use this skill to inspect and reason about the repo-local copy of `lijigang/ljg-skills`.

## Scope

This is a reference skill, not a drop-in runtime integration.

Use it when the user wants to:

- study how large personal skills are packaged
- inspect `SKILL.md + scripts + assets + references` style workflows
- compare large skills against Openwork's future skill/compiler model
- decide whether something should stay a raw skill, become an extension, or require host adaptation

## Reference Paths

Read only the relevant files under:

- `../../references/skill-libraries/ljg-skills/README.md`
- `../../references/skill-libraries/ljg-skills/skills/*/SKILL.md`
- any adjacent `scripts/`, `assets/`, or referenced files needed by the specific question

## Working Rules

1. Assume many LJG skills are host-coupled until proven otherwise.
2. Be explicit about hardcoded assumptions such as:
   - `~/.claude/...`
   - personal document directories
   - custom scripts or Playwright assets
3. Separate:
   - reusable skill methodology
   - non-portable host conventions
   - places where Openwork would need a compiler, tool adapter, or extension shell

## Deliverable Style

Prefer concise output:

- what makes the skill powerful
- what makes it host-coupled
- what could be imported as skill content
- what would need real product/runtime work
