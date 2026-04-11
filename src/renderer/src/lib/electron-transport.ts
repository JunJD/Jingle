import type { UseStreamTransport } from "@langchain/langgraph-sdk/react"
import type { ToolCall, ToolCallChunk } from "@langchain/core/messages"
import type { ActionRequest, ReviewConfig } from "langchain"
import type { StreamPayload, StreamEvent, IPCEvent, IPCStreamEvent } from "../../../types"
import { getDefaultHitlAllowedDecisions, normalizeHitlAllowedDecisions } from "../../../shared/hitl"
import { parseToolApprovalItem } from "../../../shared/tool-approval"
import type { ContentBlock } from "@/types"
import type { Subagent } from "../types"
import type { AgentInvokeMessage, AgentMessageContent } from "../../../shared/message-content"
import {
  extractComposerMessageRefsMetadata,
  hasMessageContent,
  normalizeComposerMessageRefs,
  toComposerMessageMetadata,
  toDisplayMessageContent,
  toDisplayUserMessageContent
} from "../../../shared/message-content"

/**
 * Usage metadata from LangChain model responses.
 * Contains token counts for tracking context window usage.
 */
interface UsageMetadata {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_token_details?: {
    cache_read?: number
    cache_creation?: number
    audio?: number
  }
  output_token_details?: {
    audio?: number
    reasoning?: number
  }
}

/**
 * Serialized LangGraph message chunk.
 * LangChain uses a special serialization format:
 * { lc: 1, type: "constructor", id: ["langchain_core", "messages", "AIMessageChunk"], kwargs: { ... } }
 */
interface SerializedMessageChunk {
  /** LangChain serialization marker */
  lc?: number
  type?: string
  /** Class identifier array like ['langchain_core', 'messages', 'AIMessageChunk'] */
  id?: string[]
  /** Actual message data is in kwargs */
  kwargs?: {
    id?: string
    content?: string | ContentBlock[] | AgentMessageContent
    tool_calls?: ToolCall[]
    tool_call_chunks?: ToolCallChunk[]
    tool_call_id?: string
    name?: string
    additional_kwargs?: {
      refs?: unknown
      tool_calls?: Array<{
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
      [key: string]: unknown
    }
    usage_metadata?: UsageMetadata
    response_metadata?: {
      usage?: UsageMetadata
      [key: string]: unknown
    }
  }
}

/**
 * Metadata accompanying streamed messages from LangGraph.
 * These fields are not exported from the SDK as they are internal runtime metadata.
 */
interface MessageMetadata {
  langgraph_node?: string
  langgraph_checkpoint_ns?: string
  checkpoint_ns?: string
  name?: string
}

interface InterruptActionRequest extends ActionRequest {
  id?: string
  toolCallId?: string
  description?: string
  review?: unknown
}

// Accumulated tool call data (for streaming tool calls)
interface AccumulatedToolCall {
  id: string
  name: string
  args: string // Accumulated JSON string
}

interface ValuesInterruptState {
  messages?: SerializedMessageChunk[]
  __interrupt__?: Array<{
    value?: {
      actionRequests?: InterruptActionRequest[]
      reviewConfigs?: ReviewConfig[]
    }
  }>
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`
}

function getLatestToolCallsFromSerializedMessages(
  messages: SerializedMessageChunk[] | undefined
): ToolCall[] {
  if (!Array.isArray(messages)) {
    return []
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolCalls = messages[index]?.kwargs?.tool_calls
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      return toolCalls
    }
  }

  return []
}

function findInterruptedToolCallFromState(
  state: ValuesInterruptState,
  actionIndex: number
): ToolCall | undefined {
  // Legacy fallback for interrupts emitted before the custom middleware
  // started carrying toolCallId in the payload.
  const interruptValue = state.__interrupt__?.[0]?.value
  const action = interruptValue?.actionRequests?.[actionIndex]
  if (!action) {
    return undefined
  }

  const latestToolCalls = getLatestToolCallsFromSerializedMessages(state.messages)
  const interruptNames = new Set([
    ...(interruptValue?.actionRequests ?? []).map((request) => request.name),
    ...(interruptValue?.reviewConfigs ?? []).map((config) => config.actionName)
  ])
  const interruptToolCalls = latestToolCalls.filter((toolCall) => interruptNames.has(toolCall.name))
  const positionalMatch = interruptToolCalls[actionIndex]
  const expectedArgs = stableStringify(action.args || {})

  if (
    positionalMatch &&
    positionalMatch.name === action.name &&
    stableStringify(positionalMatch.args ?? {}) === expectedArgs
  ) {
    return positionalMatch
  }

  return undefined
}

/**
 * Custom transport for useStream that uses Electron IPC instead of HTTP.
 * This allows useStream to work seamlessly in an Electron app where the
 * LangGraph agent runs in the main process.
 */
export class ElectronIPCTransport implements UseStreamTransport {
  // Track current message ID for grouping tokens across chunks
  private currentMessageId: string | null = null

  // Track active subagents by their tool_call_id
  private activeSubagents: Map<string, Subagent> = new Map()

  // Track accumulated tool call chunks (for streaming tool calls)
  private accumulatedToolCalls: Map<string, AccumulatedToolCall> = new Map()

  async stream(payload: StreamPayload): Promise<AsyncGenerator<StreamEvent>> {
    // Reset state for new stream
    this.currentMessageId = null
    this.activeSubagents.clear()
    this.accumulatedToolCalls.clear()
    // Extract thread ID and model ID from config
    const threadId = payload.config?.configurable?.thread_id
    const modelId = payload.config?.configurable?.model_id as string | undefined
    if (!threadId) {
      return this.createErrorGenerator("MISSING_THREAD_ID", "Thread ID is required")
    }

    // Check if this is a resume command (no message needed)
    const hasResumeCommand = payload.command?.resume !== undefined

    // Extract the message content from input
    const input = payload.input as
      | {
          messages?: Array<{
            additional_kwargs?: {
              refs?: unknown
            }
            content: AgentMessageContent
            id?: string
            type: string
          }>
        }
      | null
      | undefined
    const messages = input?.messages ?? []
    const lastHumanMessage = messages.find((m) => m.type === "human")
    const messageContent = lastHumanMessage?.content ?? ""
    const messageRefs = normalizeComposerMessageRefs(lastHumanMessage?.additional_kwargs?.refs)
    const invokeMessage: AgentInvokeMessage | null = lastHumanMessage
      ? {
          content: messageContent,
          id:
            typeof lastHumanMessage.id === "string" && lastHumanMessage.id.length > 0
              ? lastHumanMessage.id
              : crypto.randomUUID(),
          ...(messageRefs.length > 0 ? { additional_kwargs: { refs: messageRefs } } : {})
        }
      : null

    // Only require message content if not resuming
    if (!hasMessageContent(messageContent) && !hasResumeCommand) {
      return this.createErrorGenerator("MISSING_MESSAGE", "Message content is required")
    }

    // Create an async generator that bridges IPC events
    return this.createStreamGenerator(
      threadId,
      invokeMessage,
      payload.command,
      payload.signal,
      modelId
    )
  }

  private async *createErrorGenerator(code: string, message: string): AsyncGenerator<StreamEvent> {
    yield {
      event: "error",
      data: { error: code, message }
    }
  }

  private async *createStreamGenerator(
    threadId: string,
    message: AgentInvokeMessage | null,
    command: unknown,
    signal: AbortSignal,
    modelId?: string
  ): AsyncGenerator<StreamEvent> {
    // Create a queue to buffer events from IPC
    const eventQueue: StreamEvent[] = []
    let resolveNext: ((value: StreamEvent | null) => void) | null = null
    let isDone = false
    let hasError = false

    // Generate a run ID for this stream
    const runId = crypto.randomUUID()

    // Emit metadata event first to establish run context
    yield {
      event: "metadata",
      data: {
        run_id: runId,
        thread_id: threadId
      }
    }

    // Start the stream via IPC (pass modelId to use the selected model)
    const cleanup = window.api.agent.streamAgent(
      threadId,
      message ?? {
        content: "",
        id: crypto.randomUUID()
      },
      command,
      (ipcEvent) => {
        // Convert IPC events to SDK format
        const sdkEvents = this.convertToSDKEvents(ipcEvent as IPCEvent, threadId)

        for (const sdkEvent of sdkEvents) {
          if (sdkEvent.event === "done" || sdkEvent.event === "error") {
            isDone = true
            hasError = sdkEvent.event === "error"
          }

          // If someone is waiting for the next event, resolve immediately
          if (resolveNext) {
            const resolve = resolveNext
            resolveNext = null
            resolve(sdkEvent)
          } else {
            // Otherwise queue the event
            eventQueue.push(sdkEvent)
          }
        }
      },
      modelId
    )

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        cleanup()
        isDone = true
        if (resolveNext) {
          const resolve = resolveNext
          resolveNext = null
          resolve(null)
        }
      })
    }

    // Yield events as they come in
    while (!isDone || eventQueue.length > 0) {
      // Check for queued events first
      if (eventQueue.length > 0) {
        const event = eventQueue.shift()!
        if (event.event === "done") {
          break
        }
        if (event.event !== "error" || hasError) {
          yield event
        }
        if (hasError) {
          break
        }
        continue
      }

      // Wait for the next event
      const event = await new Promise<StreamEvent | null>((resolve) => {
        resolveNext = resolve
      })

      if (event === null) {
        break
      }

      if (event.event === "done") {
        break
      }

      yield event

      if (event.event === "error") {
        break
      }
    }
  }

  /**
   * Convert IPC events to LangGraph SDK format
   * Returns an array since a single IPC event may produce multiple SDK events
   */
  private convertToSDKEvents(event: IPCEvent, threadId: string): StreamEvent[] {
    const events: StreamEvent[] = []

    switch (event.type) {
      // Raw stream events from LangGraph - parse and convert
      case "stream": {
        const streamEvents = this.processStreamEvent(event)
        events.push(...streamEvents)
        break
      }

      case "token":
        events.push({
          event: "messages",
          data: [
            { id: event.messageId, type: "ai", content: event.token },
            { langgraph_node: "agent" }
          ]
        })
        break

      // Legacy: Tool call chunks
      case "tool_call":
        events.push({
          event: "custom",
          data: {
            type: "tool_call",
            messageId: event.messageId,
            tool_calls: event.tool_calls
          }
        })
        break

      // Legacy: Full state values
      case "values": {
        const { todos, subagents, interrupt } = event.data

        // Only emit values event if todos is defined
        // Avoid emitting { todos: [] } when undefined, which would wipe out existing todos
        if (todos !== undefined) {
          events.push({
            event: "values",
            data: { todos }
          })
        }

        // Emit subagents
        if (subagents?.length) {
          events.push({
            event: "custom",
            data: { type: "subagents", subagents }
          })
        }

        // Emit interrupt - handle both legacy format and new langchain HITL format
        if (interrupt) {
          // Check if this is the new array format from langchain HITL
          if (Array.isArray(interrupt) && interrupt.length > 0) {
            const interruptValue = interrupt[0]?.value
            const actionRequests = interruptValue?.actionRequests
            const reviewConfigs = interruptValue?.reviewConfigs

            if (actionRequests?.length) {
              const firstAction = actionRequests[0]
              const reviewConfig = reviewConfigs?.find(
                (rc: { actionName: string }) => rc.actionName === firstAction.name
              )

              events.push({
                event: "custom",
                data: {
                  type: "interrupt",
                  request: {
                    id: firstAction.id || firstAction.toolCallId || crypto.randomUUID(),
                    tool_call: {
                      ...(firstAction.toolCallId ? { id: firstAction.toolCallId } : {}),
                      name: firstAction.name,
                      args: firstAction.args || {}
                    },
                    review: parseToolApprovalItem(firstAction.review),
                    allowed_decisions: normalizeHitlAllowedDecisions(reviewConfig?.allowedDecisions)
                  }
                }
              })
            }
          } else if (interrupt.tool_call) {
            // Legacy format with direct tool_call property
            events.push({
              event: "custom",
              data: {
                type: "interrupt",
                request: {
                  id: interrupt.id || crypto.randomUUID(),
                  tool_call: interrupt.tool_call,
                  review: null,
                  allowed_decisions: getDefaultHitlAllowedDecisions()
                }
              }
            })
          }
        }
        break
      }

      case "error":
        events.push({
          event: "error",
          data: { error: "STREAM_ERROR", message: event.error }
        })
        break

      case "done":
        events.push({
          event: "done",
          data: { thread_id: threadId }
        })
        break
    }

    console.log(
      "[Transport] convertToSDKEvents total:",
      events.length,
      "events",
      events.map((e) => e.event)
    )
    return events
  }

  /**
   * Process raw LangGraph stream events (mode + data tuples)
   */
  private processStreamEvent(event: IPCStreamEvent): StreamEvent[] {
    const events: StreamEvent[] = []
    const { mode, data } = event

    if (mode === "messages") {
      // Messages mode returns [message, metadata] tuples
      const [msgChunk, metadata] = data as [SerializedMessageChunk, MessageMetadata]

      // LangChain serialization: actual data is in kwargs
      const kwargs = msgChunk?.kwargs || {}
      const classId = Array.isArray(msgChunk?.id) ? msgChunk.id : []
      const className = classId[classId.length - 1] || ""

      // Check if this is a ToolMessage (class name contains 'ToolMessage')
      const isToolMessage = className.includes("ToolMessage") && !!kwargs.tool_call_id

      // Check if this is an AI message (class name contains 'AI')
      const isAIMessage = className.includes("AI") || className.includes("AIMessageChunk")

      if (isAIMessage) {
        const content = this.extractContent(kwargs.content)
        const msgId = kwargs.id || this.currentMessageId || crypto.randomUUID()
        this.currentMessageId = msgId

        if (content || kwargs.tool_calls?.length) {
          const messageMetadata = toComposerMessageMetadata({
            refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
          })
          events.push({
            event: "messages",
            data: [
              {
                id: msgId,
                type: "ai",
                content: content || "",
                ...(messageMetadata ? { metadata: messageMetadata } : {}),
                // Include tool_calls if present
                ...(kwargs.tool_calls?.length && { tool_calls: kwargs.tool_calls })
              },
              { langgraph_node: metadata?.langgraph_node || "agent" }
            ]
          })
        }

        // Handle tool call chunks (streaming) - these have args as strings
        if (kwargs.tool_call_chunks?.length) {
          const subagentEvents = this.processToolCallChunks(kwargs.tool_call_chunks)
          events.push(...subagentEvents)

          events.push({
            event: "custom",
            data: {
              type: "tool_call",
              messageId: this.currentMessageId,
              tool_calls: kwargs.tool_call_chunks
            }
          })
        }

        // Handle complete tool calls (non-streaming) - these have args as objects
        if (kwargs.tool_calls?.length) {
          const subagentEvents = this.processCompletedToolCalls(kwargs.tool_calls)
          events.push(...subagentEvents)
        }

        // Extract usage_metadata for context window tracking
        // Usage metadata is present on completed AI messages (not streaming chunks)
        const usageMetadata = kwargs.usage_metadata || kwargs.response_metadata?.usage
        if (usageMetadata) {
          console.log("[ElectronTransport] Found usage_metadata:", {
            input_tokens: usageMetadata.input_tokens,
            output_tokens: usageMetadata.output_tokens,
            total_tokens: usageMetadata.total_tokens,
            has_cache_details: !!usageMetadata.input_token_details
          })

          // Only emit if we have actual token counts (not on every chunk)
          if (usageMetadata.input_tokens !== undefined && usageMetadata.input_tokens > 0) {
            events.push({
              event: "custom",
              data: {
                type: "token_usage",
                usage: {
                  inputTokens: usageMetadata.input_tokens,
                  outputTokens: usageMetadata.output_tokens,
                  totalTokens: usageMetadata.total_tokens,
                  cacheReadTokens: usageMetadata.input_token_details?.cache_read,
                  cacheCreationTokens: usageMetadata.input_token_details?.cache_creation
                }
              }
            })
          }
        }
      }

      // Handle ToolMessage - emit as message event and handle subagent completion
      if (isToolMessage && kwargs.tool_call_id) {
        const content = this.extractContent(kwargs.content)
        const msgId = kwargs.id || crypto.randomUUID()
        const messageMetadata = toComposerMessageMetadata({
          refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
        })

        // Emit tool message to the stream
        events.push({
          event: "messages",
          data: [
            {
              id: msgId,
              type: "tool",
              content,
              ...(messageMetadata ? { metadata: messageMetadata } : {}),
              tool_call_id: kwargs.tool_call_id,
              name: kwargs.name
            },
            { langgraph_node: metadata?.langgraph_node || "tools" }
          ]
        })

        // Handle subagent task completion
        if (kwargs.name === "task") {
          const completionEvents = this.processToolMessage(kwargs.tool_call_id)
          events.push(...completionEvents)
        }
      }
    } else if (mode === "values") {
      // Values mode returns full state with serialized LangChain messages
      const state = data as ValuesInterruptState & {
        messages?: SerializedMessageChunk[]
        todos?: { id?: string; content?: string; status?: string }[]
      }

      // Process messages in values mode to extract subagents
      if (state.messages) {
        for (const msg of state.messages) {
          const kwargs = msg.kwargs || {}
          const classId = Array.isArray(msg.id) ? msg.id : []
          const className = classId[classId.length - 1] || ""

          // Check for task tool calls in AI messages
          if (kwargs.tool_calls?.length) {
            for (const toolCall of kwargs.tool_calls) {
              if (
                toolCall.name === "task" &&
                toolCall.id &&
                !this.activeSubagents.has(toolCall.id)
              ) {
                const args = toolCall.args || {}
                if (args.subagent_type || args.description) {
                  const subagent = this.createSubagentFromTask(toolCall.id, args)
                  this.activeSubagents.set(toolCall.id, subagent)
                }
              }
            }
          }

          // Check for ToolMessage (subagent completion)
          if (className.includes("ToolMessage") && kwargs.tool_call_id && kwargs.name === "task") {
            const subagent = this.activeSubagents.get(kwargs.tool_call_id)
            if (subagent && subagent.status === "running") {
              subagent.status = "completed"
              subagent.completedAt = new Date()
            }
          }
        }

        // Emit subagent update if we have any
        if (this.activeSubagents.size > 0) {
          events.push(this.createSubagentEvent())
        }
      }

      // Transform messages from LangChain serialization format.
      // Keep human messages in the values snapshot so later values updates
      // do not wipe the backend-authored user message from stream state.
      const transformedMessages = state.messages?.map((msg) => {
        const kwargs = msg.kwargs || {}
        const classId = Array.isArray(msg.id) ? msg.id : []
        const className = classId[classId.length - 1] || ""

        // Determine message type from class name
        const type: "human" | "ai" | "tool" = className.includes("Human")
          ? "human"
          : className.includes("Tool")
            ? "tool"
            : "ai"
        const messageMetadata = toComposerMessageMetadata({
          refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
        })
        const content =
          type === "human"
            ? toDisplayUserMessageContent(kwargs.content, messageMetadata)
            : this.extractContent(kwargs.content)

        return {
          id: kwargs.id || crypto.randomUUID(),
          type,
          content,
          ...(messageMetadata ? { metadata: messageMetadata } : {}),
          // Include tool_calls for AI messages
          ...(type === "ai" && kwargs.tool_calls && { tool_calls: kwargs.tool_calls }),
          // Include tool_call_id and name for tool messages
          ...(type === "tool" && kwargs.tool_call_id && { tool_call_id: kwargs.tool_call_id }),
          ...(type === "tool" && kwargs.name && { name: kwargs.name })
        }
      })

      // Only emit values event if we have actual data to update
      // Don't emit messages: undefined as it would clear the UI
      const valuesData: Record<string, unknown> = {}
      if (transformedMessages && transformedMessages.length > 0) {
        valuesData.messages = transformedMessages
      }
      if (state.todos !== undefined) {
        valuesData.todos = state.todos
      }

      // Only emit if we have something to update
      if (Object.keys(valuesData).length > 0) {
        events.push({
          event: "values",
          data: valuesData
        })
      }

      // Emit interrupt - langchain HITL returns __interrupt__ as array of { value: HITLRequest }
      if (state.__interrupt__?.length) {
        const interruptValue = state.__interrupt__[0]?.value
        const actionRequests = interruptValue?.actionRequests
        const reviewConfigs = interruptValue?.reviewConfigs

        // For each action request (tool call) that needs approval
        if (actionRequests?.length) {
          // Get the first action request for now (can be extended for batch approvals)
          const actionIndex = 0
          const firstAction = actionRequests[0]
          const reviewConfig = reviewConfigs?.find((rc) => rc.actionName === firstAction.name)
          const matchedToolCall = findInterruptedToolCallFromState(state, actionIndex)
          const toolCallId = firstAction.toolCallId || matchedToolCall?.id
          const requestId =
            firstAction.id || firstAction.toolCallId || `hitl:${actionIndex}:${firstAction.name}`

          events.push({
            event: "custom",
            data: {
              type: "interrupt",
              request: {
                id: requestId,
                tool_call: {
                  ...(toolCallId ? { id: toolCallId } : {}),
                  name: firstAction.name,
                  args: firstAction.args || {}
                },
                review: parseToolApprovalItem(firstAction.review),
                allowed_decisions: normalizeHitlAllowedDecisions(reviewConfig?.allowedDecisions)
              }
            }
          })
        }
      }
    }

    return events
  }

  /**
   * Preserve structured message content so attachments survive transport round-trips.
   */
  private extractContent(
    content: string | ContentBlock[] | AgentMessageContent | undefined
  ): string | ContentBlock[] {
    return toDisplayMessageContent(content)
  }

  /**
   * Process streaming tool call chunks and detect task subagent invocations
   * Tool calls are streamed incrementally, so we accumulate args until we have enough
   */
  private processToolCallChunks(
    chunks: Array<{ id?: string; name?: string; args?: string }>
  ): StreamEvent[] {
    const events: StreamEvent[] = []

    for (const chunk of chunks) {
      if (!chunk.id) continue

      // Get or create accumulated tool call
      let accumulated = this.accumulatedToolCalls.get(chunk.id)
      if (!accumulated) {
        accumulated = { id: chunk.id, name: chunk.name || "", args: "" }
        this.accumulatedToolCalls.set(chunk.id, accumulated)
      }

      // Update name if provided
      if (chunk.name) {
        accumulated.name = chunk.name
      }

      // Accumulate args
      if (chunk.args) {
        accumulated.args += chunk.args
      }

      // Check if this is a "task" tool call and try to parse args
      if (accumulated.name === "task") {
        try {
          const args = JSON.parse(accumulated.args)
          // Only process if we haven't already created a subagent for this tool call
          if (!this.activeSubagents.has(chunk.id) && args.subagent_type) {
            const subagent = this.createSubagentFromTask(chunk.id, args)
            this.activeSubagents.set(chunk.id, subagent)
            events.push(this.createSubagentEvent())
          }
        } catch {
          // Args not complete yet, continue accumulating
        }
      }
    }

    return events
  }

  /**
   * Process completed tool calls (non-streaming) and detect task subagent invocations
   */
  private processCompletedToolCalls(
    toolCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>
  ): StreamEvent[] {
    const events: StreamEvent[] = []

    for (const toolCall of toolCalls) {
      if (!toolCall.id || !toolCall.name) continue

      // Check if this is a "task" tool call
      if (toolCall.name === "task" && !this.activeSubagents.has(toolCall.id)) {
        const args = toolCall.args || {}
        if (args.subagent_type || args.description) {
          const subagent = this.createSubagentFromTask(toolCall.id, args)
          this.activeSubagents.set(toolCall.id, subagent)
          events.push(this.createSubagentEvent())
        }
      }
    }

    return events
  }

  /**
   * Process a ToolMessage which signals subagent completion
   */
  private processToolMessage(toolCallId: string): StreamEvent[] {
    const events: StreamEvent[] = []

    // Check if this tool_call_id corresponds to an active subagent
    const subagent = this.activeSubagents.get(toolCallId)
    if (subagent) {
      subagent.status = "completed"
      subagent.completedAt = new Date()
      events.push(this.createSubagentEvent())
    }

    return events
  }

  /**
   * Create a Subagent object from task tool call args
   */
  private createSubagentFromTask(toolCallId: string, args: Record<string, unknown>): Subagent {
    const subagentType = (args.subagent_type as string) || "general-purpose"
    const description = (args.description as string) || "Executing task..."

    // Generate a friendly name from the subagent type
    const nameMap: Record<string, string> = {
      "general-purpose": "General Purpose Agent",
      "correctness-checker": "Correctness Checker",
      "final-reviewer": "Final Reviewer",
      "code-reviewer": "Code Reviewer",
      research: "Research Agent"
    }

    return {
      id: toolCallId,
      toolCallId,
      name: nameMap[subagentType] || this.formatSubagentName(subagentType),
      description,
      status: "running",
      startedAt: new Date(),
      subagentType
    }
  }

  /**
   * Format a subagent type string into a display name
   */
  private formatSubagentName(subagentType: string): string {
    return subagentType
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  /**
   * Create a custom event with current subagent state
   */
  private createSubagentEvent(): StreamEvent {
    return {
      event: "custom",
      data: {
        type: "subagents",
        subagents: Array.from(this.activeSubagents.values())
      }
    }
  }
}
