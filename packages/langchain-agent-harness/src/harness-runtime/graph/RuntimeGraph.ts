import { isClientTool, normalizeSystemPrompt, validateLLMHasNoBoundTools } from "./utils.js"
import { StateManager } from "./state.js"
import { RunnableCallable } from "./RunnableCallable.js"
import { createLegacyMiddlewareSegment } from "./legacy-middleware-segment.js"
import { createInternalMiddlewareExecution } from "./runtime-middleware-execution.js"
import {
  createRuntimeGraphStateSchemas,
  initializeRuntimeMiddlewareState
} from "./runtime-middleware-state.js"
import { createRuntimeStepResultRouter } from "./runtime-step-router.js"
import { rewriteLegacyGraphOutput } from "./legacy-destination-compat.js"
import { readRuntimeOperation } from "./runtime-operation-reader.js"
import { createRuntimeModelExecutor, createRuntimeToolExecutor } from "./runtime-executors/index.js"
import {
  ContextActivationNode,
  MemoryRecordingProjectionNode,
  ModelStepNode,
  OperationFrameNode,
  PermissionGateNode,
  StepResultNode,
  TitleProjectionNode,
  ToolStepNode,
  WorkingSetNode,
  type RuntimeNodeContext,
  type RuntimeNodeResult,
  type RuntimeOperationFrame,
  type RuntimePermissionPolicy,
  type RuntimeStepRoute,
  type RuntimeTargetNode,
  createRuntimeOperationFrame
} from "./nodes/index.js"
import type { RuntimeTitleGeneratorContract } from "../../runtime-contract"
import type { RuntimeProjectionFailureObserver } from "../../runtime-observation"
import { isUserDeclinedToolMessage } from "../../human-approval-middleware"
import { AIMessage, ToolMessage } from "@langchain/core/messages"
import { mergeConfigs, type RunnableConfig } from "@langchain/core/runnables"
import { END, START, StateGraph } from "@langchain/langgraph"
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint"
import type { AgentMiddleware } from "langchain"

export interface RuntimeGraphOptions {
  checkpointer?: BaseCheckpointSaver | boolean
  contextSchema?: unknown
  description?: string
  includeAgentName?: "inline"
  memoryRecordingProjectionEnabled: boolean
  middleware?: readonly AgentMiddleware[]
  model: unknown
  name?: string
  observeProjectionFailure?: RuntimeProjectionFailureObserver
  permissionPolicy: RuntimePermissionPolicy
  responseFormat?: never
  signal?: AbortSignal
  stateSchema?: unknown
  store?: BaseStore
  systemPrompt?: string
  titleGenerator: RuntimeTitleGeneratorContract
  tools?: readonly unknown[]
}

const CONTEXT_ACTIVATION_NODE_NAME = "__runtime_context_activation__"
const MEMORY_RECORDING_PROJECTION_NODE_NAME = "__runtime_memory_recording_projection__"
const MODEL_STEP_NODE_NAME = "__runtime_model_step__"
const TITLE_PROJECTION_NODE_NAME = "__runtime_title_projection__"
const OPERATION_FRAME_NODE_NAME = "__runtime_operation_frame__"
const WORKING_SET_NODE_NAME = "__runtime_working_set__"
const PERMISSION_GATE_NODE_NAME = "__runtime_permission_gate__"
const MODEL_STEP_RESULT_NODE_NAME = "__runtime_model_step_result__"
const TOOL_STEP_NODE_NAME = "__runtime_tool_step__"
const TOOL_STEP_RESULT_NODE_NAME = "__runtime_tool_step_result__"

type RuntimePrivateStateUpdate = Record<string, unknown>

function createRuntimeNodeContext(
  state: unknown,
  config: RunnableConfig,
  scratch?: { frame?: RuntimeOperationFrame }
): RuntimeNodeContext {
  return {
    config,
    operation: readRuntimeOperation(config),
    ...(scratch ? { scratch } : {}),
    state: state as RuntimeNodeContext["state"]
  }
}

function readRuntimeNodeScratch(
  state: unknown,
  config: RunnableConfig
): { frame: RuntimeOperationFrame } {
  const frame = (state as { _runtimeFrame?: RuntimeOperationFrame } | undefined)?._runtimeFrame
  if (!frame) {
    const operation = readRuntimeOperation(config)
    if (operation.kind === "resume") {
      // LangGraph resumes from the checkpointed interrupt node, so the entry node's untracked frame is not restored.
      return { frame: createRuntimeOperationFrame(operation) }
    }

    throw new Error("[RuntimeGraph] OperationFrameNode must run before target runtime nodes.")
  }

  return { frame }
}

function readRuntimeStateArray<TKey extends "contextInclusions" | "messages" | "todos">(
  state: unknown,
  key: TKey
): RuntimeNodeContext["state"][TKey] {
  const value = (state as Partial<RuntimeNodeContext["state"]> | undefined)?.[key]
  if (!Array.isArray(value)) {
    throw new Error(`[RuntimeGraph] RuntimeState is missing ${key}.`)
  }

  return value as RuntimeNodeContext["state"][TKey]
}

function readTargetNodeUpdate(result: RuntimeNodeResult): Record<string, unknown> {
  return result.stateUpdate ?? {}
}

function readTargetNodePrivateState(result: RuntimeNodeResult): RuntimePrivateStateUpdate {
  const privateState = result.privateState as Record<string, unknown> | undefined
  if (!privateState) return {}

  return {
    ...(privateState.activatedContext
      ? { _runtimeActivatedContext: privateState.activatedContext }
      : {}),
    ...(privateState.frame ? { _runtimeFrame: privateState.frame } : {}),
    ...(privateState.permissionDecision
      ? { _runtimePermissionDecision: privateState.permissionDecision }
      : {}),
    ...(privateState.workingSet ? { _runtimeWorkingSet: privateState.workingSet } : {})
  }
}

function readTargetNodeStateAndPrivateUpdate(result: RuntimeNodeResult): Record<string, unknown> {
  return {
    ...readTargetNodeUpdate(result),
    ...readTargetNodePrivateState(result)
  }
}

function readTargetRouteUpdate(result: RuntimeNodeResult): Record<string, unknown> {
  if (!result.route) return {}

  return {
    _runtimeStepRoute: result.route
  }
}

function readRuntimeStepRoute(state: unknown): RuntimeStepRoute {
  const maybeState = state as
    | {
        _runtimePermissionDecision?: { route?: RuntimeStepRoute }
      }
    | undefined
  if (maybeState?._runtimePermissionDecision?.route === "pause") return "pause"

  const messages = readRuntimeStateArray(state, "messages")
  const lastMessage = messages.at(-1)
  if (isUserDeclinedToolMessage(lastMessage)) return "finish"
  if (ToolMessage.isInstance(lastMessage)) return "continue"
  if (AIMessage.isInstance(lastMessage)) {
    const regularToolCalls = (lastMessage.tool_calls ?? []).filter(
      (toolCall) => !toolCall.name.startsWith("extract-")
    )
    return regularToolCalls.length > 0 ? "continue" : "finish"
  }

  throw new Error("[RuntimeGraph] StepResultNode cannot route without a model/tool result message.")
}

function readTargetNodeGraphOutput(result: RuntimeNodeResult): unknown {
  const privateState = result.privateState as Record<string, unknown> | undefined
  const modelOutput = privateState?.modelOutput as { graphOutput?: unknown } | undefined
  if (modelOutput && "graphOutput" in modelOutput)
    return rewriteLegacyGraphOutput(modelOutput.graphOutput, {
      modelEntryNode: WORKING_SET_NODE_NAME,
      permissionGateNode: PERMISSION_GATE_NODE_NAME
    })

  const toolUpdate = privateState?.toolUpdate as { graphOutput?: unknown } | undefined
  if (toolUpdate && "graphOutput" in toolUpdate)
    return rewriteLegacyGraphOutput(toolUpdate.graphOutput, {
      modelEntryNode: WORKING_SET_NODE_NAME,
      permissionGateNode: PERMISSION_GATE_NODE_NAME
    })

  return readTargetNodeUpdate(result)
}

class RuntimeGraphTargetNodeRunnable<TInput> extends RunnableCallable {
  constructor(input: {
    getInput: (state: unknown) => TInput
    node: RuntimeTargetNode<TInput, RuntimeNodeResult>
    toOutput: (result: RuntimeNodeResult) => unknown
  }) {
    super({
      name: input.node.kind,
      func: async (state, config) => {
        const result = await input.node.invoke(
          input.getInput(state),
          createRuntimeNodeContext(state, config, readRuntimeNodeScratch(state, config))
        )
        return input.toOutput(result)
      }
    })
  }
}

/**
 * RuntimeGraph is the current LangGraph-backed execution engine.
 * The graph topology is operation-driven; legacy middleware is isolated under internal node segments.
 */
export class RuntimeGraph {
  readonly options: RuntimeGraphOptions
  #graph: any
  #stateManager = new StateManager()
  #defaultConfig: RunnableConfig
  constructor(options: RuntimeGraphOptions, defaultConfig?: RunnableConfig) {
    this.options = options
    this.#defaultConfig = defaultConfig ?? {}
    if (options.name)
      this.#defaultConfig = mergeConfigs(this.#defaultConfig, {
        metadata: { lc_agent_name: options.name }
      })
    /**
     * validate that model option is provided
     */
    if (!options.model) throw new Error("`model` option is required to create an agent.")
    /**
     * Check if the LLM already has bound tools and throw if it does.
     */
    if (typeof options.model !== "string") validateLLMHasNoBoundTools(options.model)
    /**
     * define complete list of tools based on options and middleware
     */
    const middleware = this.options.middleware ?? []
    const middlewareExecution = createInternalMiddlewareExecution({
      middleware,
      stateManager: this.#stateManager
    })
    const toolClasses: any[] = [...(options.tools ?? []), ...middlewareExecution.tools]
    /**
     * If any of the tools are configured to return_directly after running,
     * our graph needs to check if these were called
     */
    const shouldReturnDirect = new Set(
      toolClasses
        .filter(isClientTool)
        .filter((tool) => "returnDirect" in tool && tool.returnDirect)
        .map((tool) => tool.name)
    )
    const { state, input, output } = createRuntimeGraphStateSchemas({
      hasStructuredResponse: this.options.responseFormat !== void 0,
      middleware,
      stateSchema: this.options.stateSchema
    })
    const allNodeWorkflows: any = new (StateGraph as any)(state, {
      input,
      output,
      context: this.options.contextSchema
    })
    const legacyMiddlewareSegment = createLegacyMiddlewareSegment({
      graph: allNodeWorkflows,
      middleware,
      stateManager: this.#stateManager
    })
    const modelExecutor = createRuntimeModelExecutor({
      model: this.options.model,
      systemMessage: normalizeSystemPrompt(this.options.systemPrompt),
      includeAgentName: this.options.includeAgentName,
      name: this.options.name,
      responseFormat: this.options.responseFormat,
      middleware: this.options.middleware,
      toolClasses,
      shouldReturnDirect,
      signal: this.options.signal,
      modelCallWrappers: middlewareExecution.modelCallWrappers
    })
    /**
     * Add Nodes
     */
    allNodeWorkflows.addNode(
      OPERATION_FRAME_NODE_NAME,
      new RunnableCallable({
        name: "OperationFrameNode",
        func: (state, config) =>
          readTargetNodePrivateState(
            new OperationFrameNode().invoke(undefined, createRuntimeNodeContext(state, config))
          )
      })
    )
    allNodeWorkflows.addNode(
      MODEL_STEP_NODE_NAME,
      new RuntimeGraphTargetNodeRunnable({
        getInput: (state: any) => ({ messages: state.messages }),
        node: new ModelStepNode({
          invoke: async (_input, context) => ({
            graphOutput: await modelExecutor.invoke(context.state, context.config)
          })
        }),
        toOutput: readTargetNodeGraphOutput
      })
    )
    allNodeWorkflows.addNode(
      TITLE_PROJECTION_NODE_NAME,
      new RuntimeGraphTargetNodeRunnable({
        getInput: (state: any) => ({
          messages: readRuntimeStateArray(state, "messages"),
          title: state.title
        }),
        node: new TitleProjectionNode(
          this.options.titleGenerator,
          this.options.observeProjectionFailure
        ),
        toOutput: readTargetNodeUpdate
      })
    )
    if (this.options.memoryRecordingProjectionEnabled) {
      allNodeWorkflows.addNode(
        MEMORY_RECORDING_PROJECTION_NODE_NAME,
        new RuntimeGraphTargetNodeRunnable({
          getInput: (state: any) => ({
            contextInclusions: readRuntimeStateArray(state, "contextInclusions")
          }),
          node: new MemoryRecordingProjectionNode(this.options.observeProjectionFailure),
          toOutput: readTargetNodeUpdate
        })
      )
    }
    const clientTools = toolClasses.filter(isClientTool)
    const hasToolsAvailable = clientTools.length > 0 || middlewareExecution.usesToolCallWrapper
    /**
     * Create the runtime tool executor if we have registered tools or the internal middleware
     * execution bridge can provide dynamic tool-call handling.
     */
    if (hasToolsAvailable) {
      const toolExecutor = createRuntimeToolExecutor(clientTools, {
        signal: this.options.signal,
        wrapToolCall: middlewareExecution.toolCallWrapper
      })
      allNodeWorkflows.addNode(
        TOOL_STEP_NODE_NAME,
        new RuntimeGraphTargetNodeRunnable({
          getInput: (state: any) => ({
            toolCalls: state.lg_tool_call ? [state.lg_tool_call] : []
          }),
          node: new ToolStepNode({
            execute: async (_input, context) => ({
              graphOutput: await toolExecutor.invoke(context.state, context.config)
            })
          }),
          toOutput: readTargetNodeGraphOutput
        })
      )
    }
    allNodeWorkflows.addNode(
      CONTEXT_ACTIVATION_NODE_NAME,
      new RuntimeGraphTargetNodeRunnable({
        getInput: (state: any) => ({
          contextInclusions: state.contextInclusions
        }),
        node: new ContextActivationNode({
          activate: (activationInput) => ({
            contextInclusions: readRuntimeStateArray(activationInput, "contextInclusions")
          })
        }),
        toOutput: readTargetNodeStateAndPrivateUpdate
      })
    )
    allNodeWorkflows.addNode(
      WORKING_SET_NODE_NAME,
      new RuntimeGraphTargetNodeRunnable({
        getInput: () => ({}),
        node: new WorkingSetNode({
          build: (_input, context) => ({
            contextInclusions: readRuntimeStateArray(context.state, "contextInclusions"),
            messages: readRuntimeStateArray(context.state, "messages"),
            todos: readRuntimeStateArray(context.state, "todos")
          })
        }),
        toOutput: readTargetNodePrivateState
      })
    )
    const stepResultNode = new StepResultNode({
      route: (stepInput) => stepInput.route
    })
    const permissionPolicy = this.options.permissionPolicy
    allNodeWorkflows.addNode(
      MODEL_STEP_RESULT_NODE_NAME,
      new RuntimeGraphTargetNodeRunnable({
        getInput: (state: any) => ({
          route: readRuntimeStepRoute(state)
        }),
        node: stepResultNode,
        toOutput: readTargetRouteUpdate
      })
    )
    if (hasToolsAvailable) {
      allNodeWorkflows.addNode(
        PERMISSION_GATE_NODE_NAME,
        new RuntimeGraphTargetNodeRunnable({
          getInput: (state: any) => ({
            toolCalls: state.lg_tool_call ? [state.lg_tool_call] : []
          }),
          node: new PermissionGateNode(permissionPolicy),
          toOutput: readTargetNodeStateAndPrivateUpdate
        })
      )
      allNodeWorkflows.addNode(
        TOOL_STEP_RESULT_NODE_NAME,
        new RuntimeGraphTargetNodeRunnable({
          getInput: (state: any) => ({
            route: readRuntimeStepRoute(state)
          }),
          node: stepResultNode,
          toOutput: readTargetRouteUpdate
        })
      )
    }
    /**
     * Add Edges
     */
    const modelEntryNode = WORKING_SET_NODE_NAME
    const runTerminalNode = this.options.memoryRecordingProjectionEnabled
      ? MEMORY_RECORDING_PROJECTION_NODE_NAME
      : END
    const internalMiddlewareNodes = legacyMiddlewareSegment.mountInternalNodes({
      afterModelEntryNode: TITLE_PROJECTION_NODE_NAME,
      graph: allNodeWorkflows,
      hasToolsAvailable,
      modelEntryNode,
      modelStepResultNode: MODEL_STEP_RESULT_NODE_NAME,
      permissionGateNode: PERMISSION_GATE_NODE_NAME,
      terminalNode: runTerminalNode
    })
    const exitNode = internalMiddlewareNodes.exitNode
    allNodeWorkflows.addEdge(START, OPERATION_FRAME_NODE_NAME)
    allNodeWorkflows.addEdge(OPERATION_FRAME_NODE_NAME, CONTEXT_ACTIVATION_NODE_NAME)
    allNodeWorkflows.addEdge(CONTEXT_ACTIVATION_NODE_NAME, internalMiddlewareNodes.runEntryNode)
    allNodeWorkflows.addEdge(WORKING_SET_NODE_NAME, MODEL_STEP_NODE_NAME)
    allNodeWorkflows.addEdge(MODEL_STEP_NODE_NAME, TITLE_PROJECTION_NODE_NAME)
    if (this.options.memoryRecordingProjectionEnabled) {
      allNodeWorkflows.addEdge(MEMORY_RECORDING_PROJECTION_NODE_NAME, END)
    }
    /**
     * Add tool-step edges for registered tools and internal middleware execution.
     */
    if (hasToolsAvailable) {
      const toolReturnTarget = TOOL_STEP_RESULT_NODE_NAME
      if (shouldReturnDirect.size > 0)
        allNodeWorkflows.addConditionalEdges(
          TOOL_STEP_NODE_NAME,
          this.#createToolsRouter(shouldReturnDirect, exitNode, toolReturnTarget),
          [toolReturnTarget, exitNode]
        )
      else allNodeWorkflows.addEdge(TOOL_STEP_NODE_NAME, toolReturnTarget)
    }
    allNodeWorkflows.addConditionalEdges(
      MODEL_STEP_RESULT_NODE_NAME,
      createRuntimeStepResultRouter({
        allowLegacyAfterModelJump: internalMiddlewareNodes.allowsAfterModelResultJump,
        exitNode,
        hasStructuredResponse: Boolean(this.options.responseFormat),
        hasToolsAvailable,
        modelEntryNode,
        permissionGateNode: PERMISSION_GATE_NODE_NAME
      }),
      Array.from(
        new Set([
          ...(hasToolsAvailable ? [PERMISSION_GATE_NODE_NAME] : []),
          modelEntryNode,
          exitNode
        ])
      )
    )
    if (hasToolsAvailable) {
      allNodeWorkflows.addConditionalEdges(
        PERMISSION_GATE_NODE_NAME,
        this.#createPermissionGateRouter(TOOL_STEP_NODE_NAME, TOOL_STEP_RESULT_NODE_NAME, exitNode),
        [TOOL_STEP_NODE_NAME, TOOL_STEP_RESULT_NODE_NAME, exitNode]
      )
      allNodeWorkflows.addConditionalEdges(
        TOOL_STEP_RESULT_NODE_NAME,
        this.#createToolStepResultRouter(internalMiddlewareNodes.loopEntryNode, exitNode),
        [internalMiddlewareNodes.loopEntryNode, exitNode]
      )
    }
    /**
     * compile the graph
     */
    this.#graph = allNodeWorkflows.compile({
      checkpointer: this.options.checkpointer,
      store: this.options.store,
      name: this.options.name,
      description: this.options.description
    })
  }
  /**
   * Get the compiled {@link https://docs.langchain.com/oss/javascript/langgraph/use-graph-api | StateGraph}.
   */
  get graph() {
    return this.#graph
  }
  get checkpointer() {
    return this.#graph.checkpointer
  }
  set checkpointer(value) {
    this.#graph.checkpointer = value
  }
  get store() {
    return this.#graph.store
  }
  set store(value) {
    this.#graph.store = value
  }
  /**
   * Creates a new RuntimeGraph with the given LangGraph runnable config merged into
   * the existing default config. Invocation-time config still takes precedence.
   */
  withConfig(config) {
    return new RuntimeGraph(this.options, mergeConfigs(this.#defaultConfig, config))
  }
  #createPermissionGateRouter(toolsNode, skippedToolNode, exitNode) {
    return (state) => {
      if (state._runtimePermissionDecision?.route === "pause") return exitNode
      if (state._runtimePermissionDecision?.toolExecution === "skip") return skippedToolNode
      return toolsNode
    }
  }
  #createToolStepResultRouter(loopEntryNode, exitNode) {
    return (state) => {
      if (state._runtimeStepRoute === "pause" || state._runtimeStepRoute === "error")
        return exitNode
      if (state._runtimeStepRoute === "finish") return exitNode
      return loopEntryNode
    }
  }
  /**
   * Create routing function for tools node conditional edges.
   */
  #createToolsRouter(shouldReturnDirect, exitNode, toolReturnTarget) {
    return (state) => {
      const messages = state.messages
      const lastMessage = messages[messages.length - 1]
      if (
        ToolMessage.isInstance(lastMessage) &&
        lastMessage.name &&
        shouldReturnDirect.has(lastMessage.name)
      )
        return this.options.responseFormat ? toolReturnTarget : exitNode
      return toolReturnTarget
    }
  }
  async #prepareInputState(state, config) {
    return initializeRuntimeMiddlewareState({
      config,
      graph: this.#graph,
      middleware: this.options.middleware ?? [],
      state
    })
  }
  /**
   * Executes the agent with the given state and returns the final state after all processing.
   *
   * This method runs the agent's entire workflow synchronously, including:
   * - Framing the RuntimeOperation
   * - Activating context and building the model working set
   * - Calling the model and tool executors through runtime target nodes
   * - Running the internal legacy middleware segment when configured
   *
   * @param state - Initial runtime checkpoint state or a LangGraph Command.
   *
   * @param config - Optional runtime configuration including:
   * @param config.context - The context for the agent execution.
   * @param config.configurable - LangGraph configuration options like `thread_id`, `run_id`, etc.
   * @param config.store - The store for the agent execution for persisting state, see more in {@link https://docs.langchain.com/oss/javascript/langgraph/memory#memory-storage | Memory storage}.
   * @param config.signal - An optional {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | `AbortSignal`} for the agent execution.
   * @param config.recursionLimit - The recursion limit for the agent execution.
   *
   * @returns Final checkpoint state after RuntimeGraph completes.
   */
  async invoke(state, config) {
    const mergedConfig = mergeConfigs(this.#defaultConfig, config)
    const initializedState = await this.#prepareInputState(state, mergedConfig)
    return this.#graph.invoke(initializedState, mergedConfig)
  }
  /**
   * Executes the agent with streaming, returning an async iterable of state updates as they occur.
   *
   * This method runs the agent's workflow similar to `invoke`, but instead of waiting for
   * completion, it streams high-level state updates in real-time. This allows you to:
   * - Display intermediate results to users as they're generated
   * - Monitor the agent's progress through each step
   * - React to state changes as nodes complete
   *
   * For more granular event-level streaming (like individual LLM tokens), use `streamEvents` instead.
   *
   * @param state - Initial runtime checkpoint state or a LangGraph Command.
   *
   * @param config - Optional runtime configuration including:
   * @param config.context - The context for the agent execution.
   * @param config.configurable - LangGraph configuration options like `thread_id`, `run_id`, etc.
   * @param config.store - The store for the agent execution for persisting state, see more in {@link https://docs.langchain.com/oss/javascript/langgraph/memory#memory-storage | Memory storage}.
   * @param config.signal - An optional {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal | `AbortSignal`} for the agent execution.
   * @param config.streamMode - The streaming mode for the agent execution, see more in {@link https://docs.langchain.com/oss/javascript/langgraph/streaming#supported-stream-modes | Supported stream modes}.
   * @param config.recursionLimit - The recursion limit for the agent execution.
   *
   * @returns LangGraph stream of runtime state updates.
   */
  async stream(state, config) {
    const mergedConfig = mergeConfigs(this.#defaultConfig, config)
    const initializedState = await this.#prepareInputState(state, mergedConfig)
    return this.#graph.stream(initializedState, mergedConfig)
  }
  /**
   * Visualize the graph as a PNG image.
   * @param params - Parameters for the drawMermaidPng method.
   * @param params.withStyles - Whether to include styles in the graph.
   * @param params.curveStyle - The style of the graph's curves.
   * @param params.nodeColors - The colors of the graph's nodes.
   * @param params.wrapLabelNWords - The maximum number of words to wrap in a node's label.
   * @param params.backgroundColor - The background color of the graph.
   * @returns PNG image as a buffer
   */
  async drawMermaidPng(params) {
    const arrayBuffer = await (
      await (await this.#graph.getGraphAsync()).drawMermaidPng(params)
    ).arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }
  /**
   * Draw the graph as a Mermaid string.
   * @param params - Parameters for the drawMermaid method.
   * @param params.withStyles - Whether to include styles in the graph.
   * @param params.curveStyle - The style of the graph's curves.
   * @param params.nodeColors - The colors of the graph's nodes.
   * @param params.wrapLabelNWords - The maximum number of words to wrap in a node's label.
   * @param params.backgroundColor - The background color of the graph.
   * @returns Mermaid string
   */
  async drawMermaid(params) {
    return (await this.#graph.getGraphAsync()).drawMermaid(params)
  }
  /**
   * The following are internal methods to enable support for LangGraph Platform.
   * They are not part of the public Runtime API.
   *
   * Note: we intentionally return as `never` to avoid type errors due to type inference.
   */
  /**
   * @internal
   */
  streamEvents(state, config, streamOptions) {
    const mergedConfig = mergeConfigs(this.#defaultConfig, config)
    return this.#graph.streamEvents(
      state,
      {
        ...mergedConfig,
        version: config?.version ?? "v2"
      },
      streamOptions
    )
  }
  /**
   * @internal
   */
  getGraphAsync(config) {
    return this.#graph.getGraphAsync(config)
  }
  /**
   * @internal
   */
  getState(config, options) {
    return this.#graph.getState(config, options)
  }
  /**
   * @internal
   */
  getStateHistory(config, options) {
    return this.#graph.getStateHistory(config, options)
  }
  /**
   * @internal
   */
  getSubgraphs(namespace, recurse) {
    return this.#graph.getSubgraphs(namespace, recurse)
  }
  /**
   * @internal
   */
  getSubgraphsAsync(namespace, recurse) {
    return this.#graph.getSubgraphsAsync(namespace, recurse)
  }
  /**
   * @internal
   */
  updateState(inputConfig, values, asNode) {
    return this.#graph.updateState(inputConfig, values, asNode)
  }
  /**
   * @internal
   */
  get builder() {
    return this.#graph.builder
  }
}
