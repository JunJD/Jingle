# @openwork/agent-runtime

Openwork main-process agent runtime contract.

This package owns backend agent run semantics: run context, invoke/resume/cancel lifecycle,
HITL continuation, runtime events, and host ports for tools, checkpoint, memory, workspace,
and thread history.

It must not import renderer, preload, Electron UI objects, React, or chat components.
DeepAgents/LangGraph are implementation adapters, not public API.
