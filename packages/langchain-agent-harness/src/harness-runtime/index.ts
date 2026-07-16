import type { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { LanguageModelLike } from "@langchain/core/language_models/base"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type { AgentMiddleware } from "langchain"
import type { JingleAgentRunTraceConfig } from "../run-config"
import type {
  RuntimeApprovalControllerContract,
  RuntimeTitleGeneratorContract
} from "../runtime-contract"
import type { RuntimeGraphEngine } from "../runtime-execution"
import type { RuntimeProjectionFailureObserver } from "../runtime-observation"
import { runtimeStateSchema } from "../runtime-state"
import { RuntimeGraph } from "./graph/RuntimeGraph.js"
import { createRuntimePermissionPolicy } from "./graph/runtime-permission-policy.js"
export type {
  CompactPrepareNodeInput,
  CompactPrepareNodeResult,
  CompactSummarizeNodeInput,
  CompactSummarizeNodeResult,
  CompactSummarizeUpdate,
  ContextActivationNodeResult,
  MemoryRecordingProjectionNodeResult,
  ModelStepNodeResult,
  OperationFrameNodeResult,
  PermissionGateNodeResult,
  RuntimeCompactPlan,
  RuntimeContextActivation,
  RuntimeContextActivationInput,
  RuntimeContextActivator,
  RuntimeModelStepExecutor,
  RuntimeModelStepInput,
  RuntimeModelStepOutput,
  RuntimeMemoryRecordingProjectionInput,
  RuntimeNodeBoundary,
  RuntimeNodeContext,
  RuntimeNodeResult,
  RuntimeOperationFrame,
  RuntimePermissionDecision,
  RuntimePermissionGateInput,
  RuntimePermissionPolicy,
  RuntimeStateUpdate,
  RuntimeStepRoute,
  RuntimeStepRouter,
  RuntimeTargetNode,
  RuntimeTargetNodeDescriptor,
  RuntimeTargetNodeKind,
  RuntimeTitleProjectionInput,
  RuntimeToolStepExecutor,
  RuntimeToolStepInput,
  RuntimeWorkingSet,
  RuntimeWorkingSetBuilder,
  RuntimeWorkingSetInput,
  ToolStepNodeResult,
  ToolStepUpdate,
  TitleProjectionNodeResult,
  WorkingSetNodeResult
} from "./graph/nodes"
export {
  CompactPrepareNode,
  CompactSummarizeNode,
  ContextActivationNode,
  MemoryRecordingProjectionNode,
  ModelStepNode,
  OperationFrameNode,
  PermissionGateNode,
  RUNTIME_COMPACT_NODE_ORDER,
  RUNTIME_TARGET_NODE_DESCRIPTORS,
  RUNTIME_TARGET_NODE_ORDER,
  StepResultNode,
  TitleProjectionNode,
  ToolStepNode,
  WorkingSetNode
} from "./graph/nodes"

export interface CreateRuntimeGraphEngineInput {
  approvalController: RuntimeApprovalControllerContract
  callbacks: BaseCallbackHandler[]
  checkpointer: BaseCheckpointSaver<string | number>
  memoryRecordingProjectionEnabled: boolean
  middleware: readonly RuntimeExecutionMiddleware[]
  model: string | LanguageModelLike
  observeProjectionFailure?: RuntimeProjectionFailureObserver
  systemPrompt: string
  titleGenerator: RuntimeTitleGeneratorContract
  traceConfig: JingleAgentRunTraceConfig
}

export type RuntimeExecutionMiddleware = AgentMiddleware

const RUNTIME_GRAPH_NAME = "jingle"
const RUNTIME_GRAPH_RECURSION_LIMIT = 1e4

export function createRuntimeGraphEngine(input: CreateRuntimeGraphEngineInput): RuntimeGraphEngine {
  const agent = new RuntimeGraph({
    model: input.model,
    name: RUNTIME_GRAPH_NAME,
    // RuntimeCheckpointSaver owns the runtime contract and overrides string versioning.
    checkpointer: input.checkpointer as unknown as BaseCheckpointSaver,
    memoryRecordingProjectionEnabled: input.memoryRecordingProjectionEnabled,
    observeProjectionFailure: input.observeProjectionFailure,
    permissionPolicy: createRuntimePermissionPolicy({
      approvalController: input.approvalController,
      mode: "legacy-human-approval-middleware-handoff"
    }),
    systemPrompt: input.systemPrompt,
    titleGenerator: input.titleGenerator,
    stateSchema: runtimeStateSchema,
    middleware: input.middleware
  })

  const runtime = agent.withConfig({
    callbacks: input.callbacks,
    recursionLimit: RUNTIME_GRAPH_RECURSION_LIMIT,
    ...input.traceConfig
  } as RunnableConfig)

  return {
    getState: <TValues = Record<string, unknown>>(config?: RunnableConfig, options?: unknown) =>
      runtime.getState(config, options) as Promise<{ values: TValues }>,
    invoke: (state, config) => runtime.invoke(state, config),
    stream: (state, config) => runtime.stream(state, config),
    updateState: (inputConfig, values, asNode) =>
      runtime.updateState(inputConfig, values, asNode) as Promise<RunnableConfig>
  }
}
