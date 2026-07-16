import type { ToolCall } from "@langchain/core/messages"
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
export type JingleLangGraphCheckpointMessageRole = "user" | "assistant" | "system" | "tool"

export interface JingleLangGraphCheckpointMessage {
  additionalKwargs?: Record<string, unknown>
  content: string | unknown[]
  displayContext: JingleLangGraphCheckpointMessageDisplayContext
  index: number
  kwargsId?: string
  metadataHints: JingleLangGraphCheckpointMessageMetadataHints
  name?: string
  responseMetadata?: unknown
  role: JingleLangGraphCheckpointMessageRole
  toolCallId?: string
  toolCalls: ToolCall[]
  topLevelId?: string
  topLevelToolCallId?: string
}

export interface JingleLangGraphCheckpointMessageDisplayContext {
  additional_kwargs?: Record<string, unknown>
  response_metadata?: unknown
}

export interface JingleLangGraphCheckpointMessageMetadataHints {
  refs?: unknown
  source?: string
}

export interface JingleLangGraphSerializedMessageRead {
  content: string | unknown[]
  metadataHints: JingleLangGraphCheckpointMessageMetadataHints
  messageId: string
  name: string | null
  role: JingleLangGraphCheckpointMessageRole
  toolCallId: string | null
  toolCalls: unknown[]
}

export interface ReadJingleLangGraphSerializedMessageInput {
  message: unknown
  order: number
  rawHash: string
}

export interface JingleLangGraphCheckpointConfigRead {
  checkpointId: string | null
  checkpointNs: string
}

export interface JingleLangGraphCheckpointMessageStateLookup {
  checkpointNs: string
  messageId: string
  threadId: string
  version: string
}

export interface FindEarliestJingleLangGraphCheckpointContainingMessageInput {
  latest: CheckpointTuple
  messageId: string
  messageStateIncludesMessage: (
    input: JingleLangGraphCheckpointMessageStateLookup
  ) => Promise<boolean> | boolean
  readCheckpoint: (
    config: NonNullable<CheckpointTuple["parentConfig"]>
  ) => Promise<CheckpointTuple | undefined> | CheckpointTuple | undefined
  threadId: string
}

export interface JingleLangGraphCheckpointTodo {
  content?: string
  id?: string
  status?: string
}

export interface JingleLangGraphCheckpointChannelMessage {
  id?: string | string[]
  kwargs?: {
    additional_kwargs?: Record<string, unknown>
    content?: string | unknown[]
    id?: string
    name?: string
    response_metadata?: unknown
    tool_call_id?: string
    tool_calls?: ToolCall[]
  }
  _getType?: () => string
  content?: string | unknown[]
  name?: string
  tool_call_id?: string
  tool_calls?: unknown[]
  type?: string
}

interface JingleLangGraphCheckpointState {
  checkpoint?: {
    channel_values?: {
      approvals?: unknown
      compactions?: unknown
      contextInclusions?: unknown
      messages?: JingleLangGraphCheckpointChannelMessage[]
      recordingRefs?: unknown
      tasks?: unknown
      title?: unknown
      todos?: JingleLangGraphCheckpointTodo[]
      toolDecisions?: unknown
    }
    id?: string
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readKwargs(message: unknown): Record<string, unknown> {
  if (!isRecord(message) || !isRecord(message.kwargs)) {
    return {}
  }

  return message.kwargs
}

function getSerializedMessageClassName(message: unknown): string {
  if (!isRecord(message)) {
    return ""
  }

  const id = message.id
  return Array.isArray(id) ? String(id[id.length - 1] ?? "") : ""
}

function readSerializedMessageContent(message: unknown): string | unknown[] {
  const kwargs = readKwargs(message)
  const value =
    Object.prototype.hasOwnProperty.call(kwargs, "content") && kwargs.content !== undefined
      ? kwargs.content
      : isRecord(message)
        ? message.content
        : undefined

  return typeof value === "string" || Array.isArray(value) ? value : ""
}

function getCheckpointMessageContent(
  message: JingleLangGraphCheckpointChannelMessage
): string | unknown[] {
  return readSerializedMessageContent(message)
}

function readSerializedMessageToolCalls(message: unknown): unknown[] {
  const kwargs = readKwargs(message)
  const direct = kwargs.tool_calls ?? (isRecord(message) ? message.tool_calls : undefined)
  return Array.isArray(direct) ? direct : []
}

function getCheckpointToolCalls(message: JingleLangGraphCheckpointChannelMessage): ToolCall[] {
  const toolCalls = readSerializedMessageToolCalls(message)
  if (toolCalls.length > 0) {
    return toolCalls as ToolCall[]
  }

  return []
}

function readSerializedMessageStringField(message: unknown, key: string): string | null {
  const kwargs = readKwargs(message)
  const value = kwargs[key] ?? (isRecord(message) ? message[key] : undefined)
  return typeof value === "string" && value.length > 0 ? value : null
}

function readSerializedMessageAdditionalKwargs(message: unknown): Record<string, unknown> {
  const kwargs = readKwargs(message)
  if (isRecord(kwargs.additional_kwargs)) {
    return kwargs.additional_kwargs
  }

  if (isRecord(message) && isRecord(message.additional_kwargs)) {
    return message.additional_kwargs
  }

  return {}
}

function resolveSerializedMessageRole(input: {
  defaultToAssistant: boolean
  message: unknown
}): JingleLangGraphCheckpointMessageRole {
  const { message } = input
  const className = getSerializedMessageClassName(message)
  if (className.includes("Human")) return "user"
  if (className.includes("System")) return "system"
  if (className.includes("Tool")) return "tool"
  if (className.includes("AI")) return "assistant"

  const kwargs = readKwargs(message)
  const type = isRecord(message) && typeof message.type === "string" ? message.type : null
  const lcType = typeof kwargs.type === "string" ? kwargs.type : type
  if (lcType === "human") return "user"
  if (lcType === "system") return "system"
  if (lcType === "tool") return "tool"
  if (lcType === "ai") return "assistant"

  if (isRecord(message) && typeof message._getType === "function") {
    const getType = message._getType as () => unknown
    const value = getType()
    if (value === "human") return "user"
    if (value === "system") return "system"
    if (value === "tool") return "tool"
    if (value === "ai") return "assistant"
  }

  if (input.defaultToAssistant) {
    return "assistant"
  }

  throw new Error("[LangGraphCheckpointReader] Cannot resolve LangGraph message role.")
}

export function resolveJingleLangGraphCheckpointMessageRole(
  message: JingleLangGraphCheckpointChannelMessage
): JingleLangGraphCheckpointMessageRole {
  return resolveSerializedMessageRole({
    defaultToAssistant: true,
    message
  })
}

export function readJingleLangGraphSerializedMessage(
  input: ReadJingleLangGraphSerializedMessageInput
): JingleLangGraphSerializedMessageRead {
  const role = resolveSerializedMessageRole({
    defaultToAssistant: false,
    message: input.message
  })
  const toolCallId = readSerializedMessageStringField(input.message, "tool_call_id")
  const candidates = [readSerializedMessageStringField(input.message, "id"), toolCallId]
  const messageId =
    candidates.find((candidate): candidate is string => Boolean(candidate)) ??
    `message:${input.rawHash}:${input.order}:${role}`
  const additionalKwargs = readSerializedMessageAdditionalKwargs(input.message)

  return {
    content: readSerializedMessageContent(input.message),
    metadataHints: {
      refs: additionalKwargs.refs,
      source: readString(additionalKwargs.lc_source)
    },
    messageId,
    name: readSerializedMessageStringField(input.message, "name"),
    role,
    toolCallId,
    toolCalls: readSerializedMessageToolCalls(input.message)
  }
}

export function readJingleLangGraphCheckpointMessages(
  tuple: CheckpointTuple | undefined
): JingleLangGraphCheckpointMessage[] | null {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  const messages = state?.checkpoint?.channel_values?.messages
  if (!Array.isArray(messages)) {
    return null
  }

  return messages.map((message, index) => {
    const kwargs = message.kwargs ?? {}
    const additionalKwargs = kwargs.additional_kwargs
    const responseMetadata = kwargs.response_metadata
    const displayContext: JingleLangGraphCheckpointMessageDisplayContext = {}
    if (additionalKwargs !== undefined) {
      displayContext.additional_kwargs = additionalKwargs
    }
    if (responseMetadata !== undefined) {
      displayContext.response_metadata = responseMetadata
    }

    return {
      additionalKwargs,
      content: getCheckpointMessageContent(message),
      displayContext,
      index,
      kwargsId: readString(kwargs.id),
      metadataHints: {
        refs: additionalKwargs?.refs,
        source: readString(additionalKwargs?.lc_source)
      },
      name: readString(kwargs.name ?? message.name),
      responseMetadata,
      role: resolveJingleLangGraphCheckpointMessageRole(message),
      toolCallId: readString(kwargs.tool_call_id),
      toolCalls: getCheckpointToolCalls(message),
      topLevelId: readString(message.id),
      topLevelToolCallId: readString(message.tool_call_id)
    }
  })
}

export function readJingleLangGraphCheckpointTodos(
  tuple: CheckpointTuple | undefined
): JingleLangGraphCheckpointTodo[] | null {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  const todos = state?.checkpoint?.channel_values?.todos
  return Array.isArray(todos) ? todos : null
}

export function readJingleLangGraphCheckpointContextInclusions(
  tuple: CheckpointTuple | undefined
): unknown {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  return state?.checkpoint?.channel_values?.contextInclusions
}

export function readJingleLangGraphCheckpointApprovals(
  tuple: CheckpointTuple | undefined
): unknown {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  return state?.checkpoint?.channel_values?.approvals
}

export function readJingleLangGraphCheckpointToolDecisions(
  tuple: CheckpointTuple | undefined
): unknown {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  return state?.checkpoint?.channel_values?.toolDecisions
}

export function readJingleLangGraphCheckpointCompactions(
  tuple: CheckpointTuple | undefined
): unknown {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  return state?.checkpoint?.channel_values?.compactions
}

export function readJingleLangGraphCheckpointRecordingRefs(
  tuple: CheckpointTuple | undefined
): unknown {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  return state?.checkpoint?.channel_values?.recordingRefs
}

export function readJingleLangGraphCheckpointTasks(tuple: CheckpointTuple | undefined): unknown {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  return state?.checkpoint?.channel_values?.tasks
}

export function readJingleLangGraphCheckpointTitle(tuple: CheckpointTuple | undefined): unknown {
  const state = tuple as JingleLangGraphCheckpointState | undefined
  return state?.checkpoint?.channel_values?.title
}

export function readJingleLangGraphCheckpointConfig(
  tuple: CheckpointTuple
): JingleLangGraphCheckpointConfigRead {
  const configurable = tuple.config.configurable
  return {
    checkpointId:
      typeof configurable?.checkpoint_id === "string" ? configurable.checkpoint_id : null,
    checkpointNs: typeof configurable?.checkpoint_ns === "string" ? configurable.checkpoint_ns : ""
  }
}

function readJingleLangGraphCheckpointMessagesVersion(tuple: CheckpointTuple): string | null {
  const version = tuple.checkpoint.channel_versions.messages
  if (version === undefined) {
    return null
  }
  if (typeof version !== "string") {
    throw new Error(
      `[LangGraphCheckpointReader] Checkpoint "${tuple.checkpoint.id}" has non-string messages channel version "${String(version)}".`
    )
  }
  return version
}

export async function findEarliestJingleLangGraphCheckpointContainingMessage(
  input: FindEarliestJingleLangGraphCheckpointContainingMessageInput
): Promise<CheckpointTuple | null> {
  const latestVersion = readJingleLangGraphCheckpointMessagesVersion(input.latest)
  if (!latestVersion) {
    return null
  }

  const latestConfig = readJingleLangGraphCheckpointConfig(input.latest)
  const latestIncludesMessage = await input.messageStateIncludesMessage({
    checkpointNs: latestConfig.checkpointNs,
    messageId: input.messageId,
    threadId: input.threadId,
    version: latestVersion
  })
  if (!latestIncludesMessage) {
    return null
  }

  let target = input.latest
  let cursor = input.latest
  while (cursor.parentConfig) {
    const parent = await input.readCheckpoint(cursor.parentConfig)
    if (!parent) {
      throw new Error("[LangGraphCheckpointReader] Checkpoint parent not found.")
    }

    const parentVersion = readJingleLangGraphCheckpointMessagesVersion(parent)
    if (!parentVersion) {
      break
    }

    const parentConfig = readJingleLangGraphCheckpointConfig(parent)
    const parentIncludesMessage = await input.messageStateIncludesMessage({
      checkpointNs: parentConfig.checkpointNs,
      messageId: input.messageId,
      threadId: input.threadId,
      version: parentVersion
    })
    if (!parentIncludesMessage) {
      break
    }

    target = parent
    cursor = parent
  }

  return target
}
