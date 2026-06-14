# issue-bug-0614

## Non-blocking

- `src/main/db/agent-traces.ts` currently keeps several payload-reading helpers in the projection file so it can read both current camelCase event payloads and older snake_case shapes. This is acceptable for the first tracing slice because projection is a derived, rebuildable layer, but it should later move into the event schema/normalizer boundary so `agent-traces.ts` only consumes normalized typed payloads.
- `bin/cli.js` implements `jl trace` by shelling out to the system `sqlite3 -json`. That is fine for local debugging, but packaged installs may not have a compatible sqlite3 binary on PATH. A later hardening pass should either route trace inspection through a bundled/runtime DB reader or produce a clear install-time/runtime diagnostic.
