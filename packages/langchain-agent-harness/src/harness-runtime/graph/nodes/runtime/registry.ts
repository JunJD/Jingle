import type { RuntimeTargetNodeDescriptor, RuntimeTargetNodeKind } from "./node-contract"

export const RUNTIME_TARGET_NODE_ORDER = [
  "OperationFrameNode",
  "ContextActivationNode",
  "WorkingSetNode",
  "ModelStepNode",
  "PermissionGateNode",
  "ToolStepNode",
  "StepResultNode"
] as const satisfies readonly RuntimeTargetNodeKind[]

export const RUNTIME_COMPACT_NODE_ORDER = [
  "CompactPrepareNode",
  "CompactSummarizeNode"
] as const satisfies readonly RuntimeTargetNodeKind[]

export const RUNTIME_TARGET_NODE_DESCRIPTORS = {
  OperationFrameNode: {
    boundary: "operation",
    cannot: ["call model", "write product database"],
    consumes: ["RuntimeOperation"],
    engineStatus: "wired",
    kind: "OperationFrameNode",
    privateWrites: ["frame"],
    responsibility: "Turn a RuntimeOperation into an explicit run/thread/workspace frame.",
    stateWrites: []
  },
  ContextActivationNode: {
    boundary: "context",
    cannot: ["compact history", "commit product run status"],
    consumes: ["RuntimeOperation", "RuntimeCapabilities.context", "RuntimeState.contextInclusions"],
    engineStatus: "wired",
    kind: "ContextActivationNode",
    privateWrites: ["activatedContext"],
    responsibility: "Activate selected memory, workspace, guardrail, and tool availability facts.",
    stateWrites: ["contextInclusions"]
  },
  WorkingSetNode: {
    boundary: "working-set",
    cannot: ["persist long-term facts", "call model"],
    consumes: ["RuntimeState.messages", "RuntimeState.todos", "activatedContext"],
    engineStatus: "wired",
    kind: "WorkingSetNode",
    privateWrites: ["workingSet"],
    responsibility: "Build the model-visible working set for the next model call.",
    stateWrites: []
  },
  ModelStepNode: {
    boundary: "model",
    cannot: ["execute tools", "write external durable stores directly"],
    consumes: ["workingSet", "RuntimeCapabilities.model"],
    engineStatus: "runtime-kernel-with-middleware-compat",
    kind: "ModelStepNode",
    privateWrites: ["modelOutput"],
    responsibility:
      "Own one model call and return assistant messages or tool intents as state updates.",
    stateWrites: ["messages", "title"]
  },
  PermissionGateNode: {
    boundary: "permission",
    cannot: ["let UI create approval facts", "execute tools"],
    consumes: ["modelOutput.toolCalls", "RuntimeCapabilities.control.approval"],
    engineStatus: "legacy-approval-handoff",
    kind: "PermissionGateNode",
    privateWrites: ["permissionDecision"],
    responsibility:
      "Record the permission/pause boundary before tool execution and route explicit tool-execution skip decisions while native HITL policy is still handed off to legacy approval middleware.",
    stateWrites: ["approvals", "messages"]
  },
  ToolStepNode: {
    boundary: "tool",
    cannot: ["hide infrastructure errors", "call model"],
    consumes: ["toolCalls", "RuntimeCapabilities.tools"],
    engineStatus: "runtime-kernel-with-middleware-compat",
    kind: "ToolStepNode",
    privateWrites: ["toolUpdate"],
    responsibility: "Execute tools and return tool-side RuntimeState updates.",
    stateWrites: ["approvals", "artifacts", "messages", "recordingRefs", "todos"]
  },
  StepResultNode: {
    boundary: "route",
    cannot: ["record observation", "own RuntimeState"],
    consumes: ["modelOutput", "toolUpdate", "permissionDecision"],
    engineStatus: "wired",
    kind: "StepResultNode",
    privateWrites: [],
    responsibility: "Route the operation to continue, pause, finish, or error.",
    stateWrites: []
  },
  CompactPrepareNode: {
    boundary: "compact",
    cannot: ["call model", "write summary"],
    consumes: ["RuntimeCompactOperation", "stable checkpoint envelope"],
    engineStatus: "controller-helper",
    kind: "CompactPrepareNode",
    privateWrites: ["compactPlan"],
    responsibility: "Read stable checkpoint state and compute the compaction window.",
    stateWrites: []
  },
  CompactSummarizeNode: {
    boundary: "compact",
    cannot: ["commit product facts", "project UI completion state"],
    consumes: ["compactPlan", "JingleCompactionController.summarization"],
    engineStatus: "controller-helper",
    kind: "CompactSummarizeNode",
    privateWrites: ["compactUpdate"],
    responsibility: "Summarize the compaction plan and return checkpointable RuntimeState updates.",
    stateWrites: ["compactions", "messages"]
  }
} as const satisfies Record<RuntimeTargetNodeKind, RuntimeTargetNodeDescriptor>
