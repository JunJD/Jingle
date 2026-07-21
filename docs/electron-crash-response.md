# Electron Crash Response

Use this guide when Jingle closes unexpectedly, disappears during startup, or
shows an Electron process failure. Collect evidence before relaunching or
reproducing repeatedly, because later launches and OS report rotation can make
the original incident harder to identify.

## Record The Incident

For each occurrence, record these facts exactly:

- Jingle release version and release or commit SHA
- installation method: release package, local preview, or source checkout
- operating system version, platform, and CPU architecture
- local date and time of the exit, including the time zone
- the action immediately before the exit and whether Jingle restarted or
  recovered on its own
- whether the whole application exited, one window reloaded, or a child process
  failed while the application remained open

Do not substitute a branch name such as `main` for a commit SHA. If a requested
fact is unavailable, write `unknown` instead of guessing.

## Select A macOS Crash Report

An Apple `.ips` report is OS-owned evidence. It is separate from Jingle's own
diagnostics.

1. In Finder, choose **Go > Go to Folder**.
2. Enter `~/Library/Logs/DiagnosticReports/`.
3. Sort by **Date Modified**. For a packaged release, look for `Jingle*.ips`.
   For a source checkout or local preview, also look for `Electron*.ips` because
   the executable can retain Electron's binary name.
4. Open each candidate locally and compare its `captureTime`, `name` or
   `procName`, bundle identity, and process path with the affected installation.
   Select only candidates that overlap the recorded incident time and match the
   affected build. If you cannot verify a candidate, retain it separately and
   label it unverified instead of discarding or presenting it as Jingle
   evidence.
5. If several verified reports overlap, keep those files separate and retain
   their original filenames.
6. Share a selected report only through the private channel requested by a
   maintainer. An `.ips` report can contain local paths, process details, and
   other machine information; do not paste it into a public issue.

Do not send the entire `DiagnosticReports` directory. A nearby timestamp helps
correlate evidence, but it does not by itself prove that the report caused or
belongs to the observed Jingle failure.

If no verified matching `.ips` report exists, state that explicitly. Absence of
an Apple crash report does not identify a root cause: the process might have
exited normally, been terminated externally, recovered a renderer, or produced
no retained OS report.

## Handle Jingle Diagnostics Privately

Jingle keeps local state under the configured `JINGLE_HOME`, or under
`~/.jingle` when no override is configured. This directory can contain a local
database, extension data, and other private state. Never attach the whole
directory to an issue.

Do not post the full `logs` directory or paste complete log files into a public
issue. First provide only the incident facts above. If a maintainer requests
Jingle diagnostics, agree on a private transfer channel and the exact scope
before copying any files. A diagnostics bundle should contain only the
explicitly requested `logs` material from the relevant `JINGLE_HOME`; it must
not include the database, extensions, credentials, or unrelated files.

The customer must identify the `JINGLE_HOME` that belonged to the affected
build. Maintainers must not silently inspect a default home or infer that a
different local directory contains the incident.

## Export A Jingle Support Packet

When the affected installation can still open Settings, use **General >
Diagnostic Support Packet > Export Support Packet**. Jingle asks for a
destination directory in the main process; the renderer neither supplies nor
receives that filesystem path.

The versioned JSON packet contains only validated Jingle causal diagnostic
events and the content-addressed evidence blobs that those events reference.
The exporter applies the diagnostics redaction policy again, verifies private
source permissions and blob hashes, enforces fixed scan and output bounds, and
records coverage and transfer gaps in its manifest. It does not include the
database, extension data, credentials, Electron's raw log files, unrelated
`JINGLE_HOME` contents, or Apple `.ips` reports.

An exported packet can still report `no-failure-events-observed`,
`legacy-only`, or `empty` coverage. It can also report missing retained parents
or evidence. Those are evidence gaps, not proof that no crash occurred. The
manifest records the exact source revision only when the build embeds one;
otherwise the typed value is `not-embedded` and must not be guessed from a
branch name.

Keep `.ips` selection separate and follow the private handling steps above.
Never append an unverified `.ips` report or any other local file to a Jingle
support packet.

The exporter currently fails closed on Windows because Node file modes cannot
prove that the diagnostics and destination files have private Windows ACLs.
Windows support requires a main-owned ACL and reparse-point verifier; mode-bit
or path-based guesses are not accepted.

The selected destination directory must be private. Jingle creates the packet
with an exclusive file handle and never removes it by pathname. If a write,
identity check, or directory sync fails after file creation, the typed result is
`destination_incomplete`; treat any matching file in that directory as
unverified and do not send it. A complete packet is strict JSON, so interrupted
writes do not become valid support evidence.

## Maintainer Health Gate

Before reading individual events, a maintainer runs the repository's bounded
diagnostics inspector against the privately provided, explicitly authorized
bundle:

```bash
node .codex/skills/investigate-jingle-diagnostics/scripts/inspect-diagnostics.mjs \
  --home "/path/to/authorized-bundle" health
```

The inspector does not assume `~/.jingle`. Its `--home` must point to the root
of the authorized bundle that contains the copied `logs` directory.

The maintainer must evaluate the complete `health` result before interpreting
`coverage`. Investigation stops when coverage is not
`"causal-events-observed"`. Duplicate event IDs also stop event lookup because
the identity is ambiguous. Insecure or unsafe paths and permissions can exclude
material from coverage; excluded material must never be reinterpreted as an
absence of events.

Other health gaps limit only the affected query or inference. The inspector can
exclude an unsafe parent edge while retaining valid nodes, and missing or
corrupt evidence can leave safe event metadata available. A maintainer may
continue a bounded investigation of accepted nodes, but must not claim
completeness, infer through an excluded edge or evidence blob, or claim that an
event did not occur across a skipped, truncated, malformed, incompatible,
sequence, retention, or transfer gap.

With usable coverage, the maintainer searches a bounded time window and
selected event codes or resource references, rather than loading or publishing
the whole journal.

Examples of evidence gaps, not root causes, include:

- `no-failure-events-observed`, `legacy-only`, or `empty` coverage
- nonzero `insecureJournalPermissions`, `unsafeJournalPaths`,
  `unsafeEvidencePermissions`, or `unsafeEvidencePaths`
- nonzero `skippedSegments`, `malformedLines`, or `incompatibleGraphLines`
- a truncated journal scan or evidence-blob check
- duplicate event IDs or excluded causal edges
- sequence gaps or missing, corrupt, or unchecked referenced evidence

If the matching `.ips` report is absent and the Jingle diagnostics health gate
has no usable causal failure event, report **insufficient evidence**. Do not
infer a cause from timestamps, startup information, legacy log lines, or the
fact that Electron exited.

## Public Issue Summary

A public issue may include the reproduction steps, release/commit identity,
platform, architecture, local incident time with time zone, and the health
gate's coverage category. It should not include raw `.ips` contents, a complete
diagnostics journal, evidence blobs, absolute local paths, credentials, or the
contents of `JINGLE_HOME`.

Security-sensitive evidence follows [SECURITY.md](../SECURITY.md), not a public
bug report.
