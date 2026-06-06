# @openwork/agent-core

Openwork renderer agent core contract.

This package owns frontend agent state/controller semantics: composer state, runtime event
projection, invoke/resume/stop/retry control, and tool/HITL renderer registration.

It must not execute backend tools, persist runs, read checkpoints, or import main-process
services. Chat message and input styling live in the app UI, not in this package.
