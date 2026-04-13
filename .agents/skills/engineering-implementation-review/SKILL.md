---
name: engineering-implementation-review
description: Review engineering implementations for layering, maintainability, and architectural hygiene before they land.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# Engineering Implementation Review

Use this skill when reviewing implementation quality, code structure, or whether a change is ready to land.

## Core Review Goals

1. Keep architecture boundaries clear
2. Keep business logic readable
3. Prevent compatibility hacks from becoming permanent design
4. Catch local "works now" fixes that create long-term debt

## Hard Rule: Do Not Hide Parsing Helpers Inside Business Files

When a file's main job is business orchestration, middleware wiring, service flow, or UI behavior:

- do **not** introduce low-level parsing/coercion helpers inline in that file
- do **not** bury helpers like `optionalNullableString`, `requireString`, `asX`, `normalizeY` beside the business flow unless that file is explicitly the parser/codec layer
- do **not** mix input decoding with domain behavior in the same implementation unit

Instead:

- move input parsing into a dedicated parser/schema/codec module
- let business files depend on parsed, typed inputs
- keep the orchestration file focused on workflow, not ad hoc string/object cleanup

### Smell Examples

These are review smells and should be called out:

- middleware files accumulating `requireString` / `optionalString` / `optionalNullableString`
- service files mixing persistence flow with raw payload coercion
- UI components containing data-shape repair helpers
- tool registration files doing request decoding, validation, normalization, and business execution all together

### Preferred Direction

- `*-parser.ts`
- `*-schema.ts`
- `*-codec.ts`
- `normalizers.ts`

Business files should read like:

1. receive typed input
2. call domain/service logic
3. return result

not like:

1. coerce strings
2. patch nullability
3. infer shapes
4. validate ad hoc
5. finally run business logic

## Review Output

When this rule is violated, reviewers should explicitly say:

- which file is carrying mixed responsibilities
- which helpers should move out
- what the target layer should be
- whether the issue blocks landing now or can be cleaned in the next iteration
