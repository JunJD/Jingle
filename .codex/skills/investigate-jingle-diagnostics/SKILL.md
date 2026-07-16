---
name: investigate-jingle-diagnostics
description: Inspect a compatible Jingle causal-diagnostics bundle without loading whole logs, or determine that a bundle has only informational nodes, legacy lines, or no failure-graph coverage. Use when Codex receives an explicit JINGLE_HOME or diagnostic bundle and needs to assess failure coverage, trace a diagnostic event ID, inspect causal parents, or expand bounded redacted evidence.
---

# Investigate Jingle Diagnostics

Use the bundled inspector as the only default entry into diagnostics. Never `cat`, `tail`, or paste an entire journal or blob into context. Do not claim that a release is production-investigable until `health` observes causal events from that exact bundle.

## Workflow

1. Establish provenance before reading evidence: record the Jingle HEAD/release, platform, observation time, and the explicit diagnostic home or bundle path. Do not silently read the user's default `~/.jingle`; require `JINGLE_HOME` or pass `--home` after the user has placed that location in scope.
2. Run `health` to measure coverage and gaps without loading event content. Continue only when `coverage` is `causal-events-observed`, meaning at least one compatible `warn` or `error` graph node exists. Insecure journal segments are excluded from coverage. For `no-failure-events-observed`, `legacy-only`, or `empty`, stop and report that this bundle has no usable failure graph; do not treat startup/session nodes as incident evidence or infer edges from legacy text or timestamps. Stop on duplicate event IDs because lookup is ambiguous. Missing, duplicate, cross-session, non-past, and cyclic parent edges are health gaps; the inspector excludes them from `search`, `show`, and `graph`, so never restore or infer those edges yourself.
3. Run `search` with the narrowest known `eventCode`, resource ref, severity, and time window. Keep the default limit or lower it.
4. Select at most three event IDs. Run `graph` at depth 1; increase to depth 2 only when the first neighborhood does not distinguish the cause.
5. Run `show` only for the selected nodes. Treat `parentEventIds` as causal edges, `refs` as identity links, and timestamps/correlation as supporting evidence rather than causality.
6. State a concrete hypothesis before running `blob`. Expand at most two evidence blobs initially, each at the default byte limit. Blob content is a secondarily redacted view; offsets refer to that redacted view, not the source CAS bytes. Use offsets only when the previous range contains discriminating evidence.
7. Stop after two expansions add no useful evidence. Report the missing event/blob/ref or retention gap instead of loading more data speculatively.

## Commands

Run from this skill directory or use the absolute script path:

```bash
node scripts/inspect-diagnostics.mjs --home "$JINGLE_HOME" health
node scripts/inspect-diagnostics.mjs --home "$JINGLE_HOME" search --since 24h --level warn --limit 20
node scripts/inspect-diagnostics.mjs --home "$JINGLE_HOME" search --code "$EVENT_CODE" --ref "$REF_SELECTOR"
node scripts/inspect-diagnostics.mjs --home "$JINGLE_HOME" search --fingerprint "$FINGERPRINT"
node scripts/inspect-diagnostics.mjs --home "$JINGLE_HOME" graph "$EVENT_ID" --direction both --depth 1
node scripts/inspect-diagnostics.mjs --home "$JINGLE_HOME" show "$EVENT_ID"
node scripts/inspect-diagnostics.mjs --home "$JINGLE_HOME" blob "$BLOB_ID" --max-bytes 4096
```

All investigation commands return compact JSON. Evidence is never expanded by `health`, `search`, `graph`, or `show`. The inspector applies output-side secret and absolute-path redaction even when the bundle is old or tampered.

## Token Budget

- Keep one investigation under 24 KiB of tool output unless the user explicitly raises the budget.
- Keep `search` at 20 events or fewer, `graph` at 30 nodes or fewer, and depth at 2 or less.
- Prefer stable IDs, counts, codes, and edges over copied messages or stacks.
- Summarize repeated fingerprints once and cite exemplar event IDs.
- Never write Agent query results back into diagnostics; avoid observability feedback loops.

## Ownership Rules

- Compatible `warn` and `error` graph nodes in the diagnostics JSONL journal are the append-only failure-evidence source. Informational and legacy lines do not open investigation coverage.
- Evidence blobs are content-addressed details referenced by `blobId`; they are not graph nodes.
- `agent_events` remains the runtime fact owner. Agent traces and any future diagnostics index remain rebuildable projections.
- A missing parent or blob is a visible coverage gap. Unsafe paths or permissions are also gaps, not evidence. Do not manufacture an edge or infer core state from a presentation failure.

Read [references/schema.md](references/schema.md) only when adding a producer, interpreting an unfamiliar event code, or validating a diagnostic bundle. Do not load it for routine searches.

## Report

Lead with the incident/failure conclusion. Cite `eventId`, `eventCode`, relevant resource refs, and blob IDs used. Separate confirmed facts, causal inference, missing evidence, user impact, and the real owner path.
