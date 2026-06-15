# issue-bug-0614

## Non-blocking

### 2026-06-15

- `src/main/db/agent-traces.ts` currently keeps several payload-reading helpers in the projection file so it can read both current camelCase event payloads and older snake_case shapes. This is acceptable for the first tracing slice because projection is a derived, rebuildable layer, but it should later move into the event schema/normalizer boundary so `agent-traces.ts` only consumes normalized typed payloads.
- `src/main/agent/title-middleware.ts` still reads raw `tool_calls`, `tool_call_chunks`, and `additional_kwargs.tool_calls` as a read-only signal to avoid title generation while tool calls are pending. It does not produce durable ToolCall facts, so it is not blocking the current cleanup, but this raw-shape observer should be named or isolated if we continue tightening the canonical stream boundary.
