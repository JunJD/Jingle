# Jingle Causal Diagnostics Schema

## Storage

- Journal: `$JINGLE_HOME/logs/jingle.log` plus numbered rotations.
- Evidence CAS: `$JINGLE_HOME/logs/blobs/sha256/<prefix>/<sha256>.json`.
- Writer-owned diagnostics directories are regular, non-symlink directories forced to mode `0700`; journal, rotations, and evidence blobs are regular, non-symlink files forced to `0600`. Derived paths are contained under the explicit diagnostics root and final file opens use `O_NOFOLLOW` where available.
- Evidence storage has a 32 MiB ceiling. Before a new blob is written, the writer removes only blobs that are no longer referenced by retained journal segments. If retained evidence fills the ceiling, the new evidence ref is recorded with `capture: "failed"` instead of deleting reachable evidence.
- A journal record is capped at 256 KiB. Strict graph appends reject oversize nodes; legacy logger calls emit a small `diagnostic.oversize` marker instead of poisoning retention with a giant line.
- The journal is authoritative for diagnostics events. A future SQLite index is query-only and rebuildable.
- Runtime facts remain in their existing owners. Diagnostics links to them through typed refs and never copies their payloads.

## Event Envelope

`recordType: "diagnostic.event"` identifies graph nodes. Schema version 1 fields:

- `eventId`: sink-generated `diag:<sessionId>:<sequence>` ID.
- `sessionId`, `sequence`, `timestamp`: writer provenance and append order.
- `level`, `eventCode`, `component`, `operation`: classification.
- `message`: bounded catalog-style summary, never a prompt or payload.
- `recoverable`, `stateImpact`, `fingerprint`: impact and grouping metadata.
- `parentEventIds`: causal parents accepted by the writer.
- `refs`: typed identity references such as `thread`, `run`, `window`, or `checkpoint`.
- `dimensions`: at most 16 bounded scalar values.
- `evidenceRefs`: content-addressed descriptors; no evidence value is inline.
- `processKind`, `redactionVersion`: capture provenance.

All envelope strings, including classification fields and evidence metadata, are sanitized and hard-bounded before append. Redaction version 2 covers prefixed API tokens, Basic/Bearer credentials, signed or unsigned JWTs, PEM blocks, secret-bearing keys and assignments, URL credentials/query data, POSIX absolute paths, and Windows drive, UNC, or device paths. Producers still own the stronger rule: summaries, fingerprints, dimensions, and refs must be catalog metadata or stable IDs, never copied payloads.

Producer input uses bounded `dimensionEntries: [{ key, value }]`; legacy object-shaped `dimensions` is not enumerated and is replaced by an `unsafeDimensionObjectCount` marker. Evidence traversal accepts scalars, arrays, and native `Error` fields. Arbitrary objects are represented as `[object-omitted]`, so producers must select a small explicit array of evidence facts instead of handing the recorder a broad payload object.

## DAG Invariant

The main-process writer assigns a strictly increasing sequence per session. A causal parent is accepted only when:

1. It was issued by the same writer session.
2. Its sequence is smaller than the child sequence.
3. The parent ref is the exact in-process object issued by that writer, and its event ID matches the session/sequence pair.
4. The child has no more than four causal parents.
5. The parent journal append completed successfully before the child node is written.

Invalid or future parents are omitted and counted in `dimensions.invalidParentCount`; a parent whose append failed is omitted and counted in `dimensions.missingDurableParentCount`. Cross-session and external facts belong in `refs`, not `parentEventIds`. These constraints make the accepted parent-to-child graph acyclic by construction.

The writer retains at most 256 queued nodes and 4 MiB of queued evidence. One capture shares a global traversal node/byte budget across its evidence values. Producer-defined accessors are never invoked, proxies are represented by a marker, and cycle/depth/breadth exhaustion is explicit. The only accessor exception is a runtime-native `Error.stack` getter whose identity matches a fresh native `Error`, after the writer verifies that `Error.prepareStackTrace` is unchanged and `name`/`message` resolve through data-only string properties. Evidence over the memory bound is represented as failed refs. Nodes dropped at the event bound leave sequence gaps and are summarized by the next durable event or shutdown flush.

## Evidence

Evidence is sanitized before hashing and persistence. The producer rules above apply before content hashing. Each evidence item is capped at 64 KiB before storage.

`evidenceRefs` include:

- `blobId` and `sha256`: content identity.
- `kind` and `contentType`: interpretation.
- `sizeBytes`, `originalSizeBytes`, `truncated`: retrieval bounds.
- `capture`: `stored` or `failed`.
- `redactionVersion`: sanitizer contract.

Identical redacted evidence produces one blob. A failed blob write does not change the business outcome; the event remains visible with `capture: "failed"`.

External deletion or corruption can leave an event without its blob. `health` reports that gap, and the investigator must not infer the missing content.

## Coverage Gate

The skill does not assume any failure producer is present in a release. `health.coverage` is `causal-events-observed`, `no-failure-events-observed`, `legacy-only`, or `empty`. Only schema-v1 `warn` or `error` nodes with a supported redaction version and a valid complete envelope open causal failure coverage; compatible `info` nodes are counted but cannot make a bundle production-investigable. Rejected candidates increment `incompatibleGraphLines`. Only `causal-events-observed` permits graph investigation. Event-code references belong here only after their failure producer is merged and observed in a compatible bundle.

## Query Bounds

- Journal scan: at most 8 MiB from the newest retained segments.
- Search: default 20, hard maximum 100 events.
- Graph: default depth 1 and 30 nodes; hard maximum depth 4 and 100 nodes.
- Blob: default 4 KiB, hard maximum 16 KiB per call.
- Commands return metadata first. Blob values require an explicit blob ID and command.
- `health` checks duplicate/invalid event IDs, malformed shapes, sequence gaps, non-past or cross-session parents, cycles, missing parents, failed blob captures, missing/corrupt blobs, size mismatches, unsafe paths, and private permission gaps. Duplicate event IDs block investigation commands because lookup is ambiguous. Missing, duplicate, cross-session, non-past, and therefore cyclic parent edges are reported but excluded from every compact event and graph traversal. Insecure journal segments are skipped; an insecure diagnostic home or logs directory cannot open causal coverage. Blob checks are capped at 500 unique IDs and report when truncated.
- The inspector independently redacts all emitted metadata and evidence. `blob` validates the source CAS hash, then paginates a fully redacted UTF-8 view; `offset`, `nextOffset`, and `totalBytes` describe that view, while `sourceBytes` describes the verified stored file.
- `blob` rejects symlinks, unsafe permissions, unreferenced IDs, and paths outside the explicit diagnostic home. Secure opens compare the final file plus ancestor directory identities and canonical paths again after open. It caps stored files at 64 KiB and keeps redacted-view offsets on UTF-8 boundaries.
