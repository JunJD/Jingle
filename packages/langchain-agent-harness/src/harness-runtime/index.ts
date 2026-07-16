import type { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { LanguageModelLike } from "@langchain/core/language_models/base"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type { AgentMiddleware } from "langchain"
import type { JingleHarnessHookContract } from "../harness-hooks"
import type { JingleAgentRunTraceConfig } from "../run-config"
import type { RuntimeApprovalControllerContract } from "../runtime-contract"
import type { RuntimeGraphEngine } from "../runtime-execution"
import { runtimeStateSchema } from "../runtime-state"
import { RuntimeGraph } from "./graph/RuntimeGraph.js"
import { createRuntimePermissionPolicy } from "./graph/runtime-permission-policy.js"
export type {
  CompactPrepareNodeResult,
  CompactSummarizeNodeInput,
  CompactSummarizeNodeResult,
  CompactSummarizeUpdate,
  ContextActivationNodeResult,
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
  RuntimeToolStepExecutor,
  RuntimeToolStepInput,
  RuntimeWorkingSet,
  RuntimeWorkingSetBuilder,
  RuntimeWorkingSetInput,
  ToolStepNodeResult,
  ToolStepUpdate,
  WorkingSetNodeResult
} from "./graph/nodes"
export {
  CompactPrepareNode,
  CompactSummarizeNode,
  ContextActivationNode,
  ModelStepNode,
  OperationFrameNode,
  PermissionGateNode,
  RUNTIME_COMPACT_NODE_ORDER,
  RUNTIME_TARGET_NODE_DESCRIPTORS,
  RUNTIME_TARGET_NODE_ORDER,
  StepResultNode,
  ToolStepNode,
  WorkingSetNode
} from "./graph/nodes"

export interface CreateRuntimeGraphEngineInput {
  approvalController: RuntimeApprovalControllerContract
  callbacks: BaseCallbackHandler[]
  checkpointer: BaseCheckpointSaver<string | number>
  middleware: readonly RuntimeExecutionMiddleware[]
  model: string | LanguageModelLike
  systemPrompt: string
  traceConfig: JingleAgentRunTraceConfig
}

export interface RuntimeMiddlewareHook<
  TMiddleware extends AgentMiddleware = AgentMiddleware
> extends JingleHarnessHookContract {
  createMiddleware(): TMiddleware
}

export type RuntimeExecutionMiddleware = AgentMiddleware | RuntimeMiddlewareHook

const RUNTIME_GRAPH_NAME = "jingle"
const RUNTIME_GRAPH_RECURSION_LIMIT = 1e4

export function compileRuntimeHookToMiddleware<TMiddleware extends AgentMiddleware>(
  hook: RuntimeMiddlewareHook<TMiddleware>
): TMiddleware {
  return hook.createMiddleware()
}

export function resolveRuntimeMiddleware(input: {
  middleware: readonly RuntimeExecutionMiddleware[]
}): AgentMiddleware[] {
  return input.middleware.map((entry) =>
    isRuntimeMiddlewareHook(entry) ? compileRuntimeHookToMiddleware(entry) : entry
  )
}

function isRuntimeMiddlewareHook(
  entry: RuntimeExecutionMiddleware
): entry is RuntimeMiddlewareHook {
  return "createMiddleware" in entry
}

export function createRuntimeGraphEngine(input: CreateRuntimeGraphEngineInput): RuntimeGraphEngine {
  const agent = new RuntimeGraph({
    model: input.model,
    name: RUNTIME_GRAPH_NAME,
    // RuntimeCheckpointSaver owns the runtime contract and overrides string versioning.
    checkpointer: input.checkpointer as unknown as BaseCheckpointSaver,
    permissionPolicy: createRuntimePermissionPolicy({
      approvalController: input.approvalController,
      mode: "legacy-human-approval-middleware-handoff"
    }),
    systemPrompt: input.systemPrompt,
    stateSchema: runtimeStateSchema,
    middleware: resolveRuntimeMiddleware({
      middleware: input.middleware
    })
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
