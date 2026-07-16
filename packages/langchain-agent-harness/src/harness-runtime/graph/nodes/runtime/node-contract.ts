import type { BaseMessage } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import type {
  RuntimeCompactOperation,
  RuntimeOperation,
  RuntimeRunContext
} from "../../../../runtime-operation"
import type { RuntimeCheckpointState } from "../../../../runtime-state"

export type RuntimeNodeBoundary =
  | "operation"
  | "context"
  | "working-set"
  | "model"
  | "permission"
  | "tool"
  | "route"
  | "compact"

export type RuntimeTargetNodeKind =
  | "OperationFrameNode"
  | "ContextActivationNode"
  | "WorkingSetNode"
  | "ModelStepNode"
  | "PermissionGateNode"
  | "ToolStepNode"
  | "StepResultNode"
  | "CompactPrepareNode"
  | "CompactSummarizeNode"

export type RuntimeStepRoute = "continue" | "pause" | "finish" | "error"

export type RuntimeTargetNodeEngineStatus =
  | "controller-helper"
  | "wired"
  | "runtime-kernel-with-middleware-compat"
  | "legacy-approval-handoff"

export type RuntimeStateUpdate = Partial<RuntimeCheckpointState> & Record<string, unknown>

export interface RuntimeOperationFrame {
  readonly kind: RuntimeOperation["kind"]
  readonly runId: string
  readonly threadId: string
  readonly workspacePath: string
}

export interface RuntimeWorkingSet {
  readonly contextInclusions: RuntimeCheckpointState["contextInclusions"]
  readonly messages: BaseMessage[]
  readonly todos: RuntimeCheckpointState["todos"]
}

export interface RuntimeCompactPlan {
  readonly checkpointConfig: RunnableConfig
  readonly messages: BaseMessage[]
  readonly operation: RuntimeCompactOperation
  readonly preserveLastUserMessageCount?: number
  readonly trigger: RuntimeCompactOperation["trigger"]
}

export interface RuntimeNodeScratch {
  readonly compactPlan?: RuntimeCompactPlan
  readonly frame?: RuntimeOperationFrame
  readonly workingSet?: RuntimeWorkingSet
}

export interface RuntimeNodeContext<
  TState extends RuntimeCheckpointState = RuntimeCheckpointState
> {
  readonly config?: RunnableConfig
  readonly operation: RuntimeOperation
  readonly scratch?: RuntimeNodeScratch
  readonly state: TState
}

export interface RuntimeNodeResult<
  TStateUpdate extends RuntimeStateUpdate = RuntimeStateUpdate,
  TPrivateState extends Record<string, unknown> = Record<string, unknown>
> {
  readonly privateState?: TPrivateState
  readonly route?: RuntimeStepRoute
  readonly stateUpdate?: TStateUpdate
}

export interface RuntimeTargetNode<
  TInput = undefined,
  TResult extends RuntimeNodeResult = RuntimeNodeResult
> {
  readonly boundary: RuntimeNodeBoundary
  readonly kind: RuntimeTargetNodeKind
  invoke(input: TInput, context: RuntimeNodeContext): Promise<TResult> | TResult
}

export interface RuntimeTargetNodeDescriptor {
  readonly boundary: RuntimeNodeBoundary
  readonly cannot: readonly string[]
  readonly consumes: readonly string[]
  readonly kind: RuntimeTargetNodeKind
  readonly privateWrites: readonly string[]
  readonly responsibility: string
  readonly engineStatus: RuntimeTargetNodeEngineStatus
  readonly stateWrites: readonly string[]
}

export type RuntimePermissionToolExecution = "continue" | "skip"

export interface RuntimePermissionDecision {
  readonly approvals?: RuntimeCheckpointState["approvals"]
  readonly messages?: RuntimeCheckpointState["messages"]
  readonly owner: "legacy-human-approval-middleware"
  readonly reason?: string
  readonly route: Extract<RuntimeStepRoute, "continue" | "pause">
  readonly toolExecution: RuntimePermissionToolExecution
}

export function createRuntimeOperationFrame(operation: RuntimeOperation): RuntimeOperationFrame {
  return {
    kind: operation.kind,
    runId: operation.runId,
    threadId: operation.threadId,
    workspacePath: operation.workspacePath
  }
}

export function assertRuntimeRunContext(operation: RuntimeOperation): RuntimeRunContext {
  return {
    runId: operation.runId,
    threadId: operation.threadId,
    workspacePath: operation.workspacePath
  }
}
