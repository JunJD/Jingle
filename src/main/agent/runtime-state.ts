import {
  projectJingleLangGraphCheckpointMessages,
  projectJingleLangGraphCheckpointThreadFacts,
  type ProjectJingleLangGraphCheckpointMessagesInput,
  type ProjectJingleLangGraphCheckpointThreadFactsInput
} from "@jingle/langchain-agent-harness/transitional"
import type { JingleLangGraphCheckpointMessage } from "@jingle/langchain-agent-harness/transitional"
import type {
  RuntimeApproval,
  RuntimeCompaction,
  RuntimeRecordingRef,
  RuntimeTask,
  RuntimeToolDecision
} from "@jingle/langchain-agent-harness"
import type { HitlRequestRow } from "../db"
import type { HITLRequest, Todo } from "../types"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import { isHitlDecisionType } from "@shared/hitl"
import { parseToolApprovalItem } from "@shared/tool-approval"
import { parseOptionalToolDecision } from "@shared/tool-decision"
import {
  normalizeComposerMessageRefs,
  toComposerMessageMetadata,
  toDisplayAssistantMessageContent,
  toDisplayMessageContent,
  toDisplayUserMessageContent
} from "@shared/message-content"

export type JingleCheckpointProjectionSource =
  | ProjectJingleLangGraphCheckpointMessagesInput["tuple"]
  | ProjectJingleLangGraphCheckpointThreadFactsInput["tuple"]

function getCheckpointMessageMetadata(
  message: JingleLangGraphCheckpointMessage
): Record<string, unknown> | null {
  const refs = normalizeComposerMessageRefs(message.metadataHints.refs)
  const metadata = toComposerMessageMetadata({ refs }) ?? {}
  const lcSource = message.metadataHints.source
  const toolDecision = parseOptionalToolDecision(
    message.displayContext.additional_kwargs?.jingle_tool_decision
  )

  if (lcSource === "summarization") {
    metadata.lc_source = lcSource
  }
  if (toolDecision) metadata.jingle_tool_decision = toolDecision

  return Object.keys(metadata).length > 0 ? metadata : null
}

function getRequiredHitlRowToolCallId(
  row: Pick<HitlRequestRow, "request_id" | "tool_call_id">
): string {
  if (typeof row.tool_call_id === "string" && row.tool_call_id.length > 0) {
    return row.tool_call_id
  }

  throw new Error(`[RuntimeState] HITL request "${row.request_id}" is missing tool_call_id.`)
}

function parseHitlJson(row: HitlRequestRow, field: string, value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new Error(`[RuntimeState] HITL request "${row.request_id}" has invalid ${field}.`, {
      cause: error
    })
  }
}

export function extractMessagesFromCheckpoint(
  threadId: string,
  tuple: JingleCheckpointProjectionSource
): Array<{
  message_id: string
  role: string
  kind: string
  content: string
  tool_calls?: string | null
  tool_call_id?: string | null
  name?: string | null
  metadata?: string | null
  created_at: number
}> {
  return projectJingleLangGraphCheckpointMessages({
    threadId,
    tuple,
    toDisplayContent: (content, message) => {
      if (message.role === "assistant") {
        return toDisplayAssistantMessageContent(content, message.displayContext)
      }
      if (message.role === "user") {
        return toDisplayUserMessageContent(content, getCheckpointMessageMetadata(message))
      }
      return toDisplayMessageContent(content, {
        role: message.role,
        ...(message.toolCallId || message.topLevelToolCallId
          ? { toolCallId: message.toolCallId ?? message.topLevelToolCallId }
          : {})
      })
    },
    toMessageMetadata: getCheckpointMessageMetadata
  })
}

export function extractThreadFactsFromCheckpoint(
  threadId: string,
  tuple: JingleCheckpointProjectionSource,
  options?: {
    runId?: string | null
  }
): {
  approvals: RuntimeApproval[]
  compactions: RuntimeCompaction[]
  contextInclusions: AgentContextInclusion[]
  hasInterrupt: boolean
  hitlRequest: HITLRequest | null
  recordingRefs: RuntimeRecordingRef[]
  tasks: RuntimeTask[]
  title: string | null
  todos: Todo[]
  toolDecisions: RuntimeToolDecision[]
} {
  const facts = projectJingleLangGraphCheckpointThreadFacts<
    AgentContextInclusion,
    HITLRequest["review"]
  >({
    parseReview: parseToolApprovalItem,
    runId: options?.runId,
    threadId,
    tuple
  })

  return {
    approvals: facts.approvals,
    compactions: facts.compactions,
    contextInclusions: facts.contextInclusions,
    hasInterrupt: facts.hasInterrupt,
    hitlRequest: facts.hitlRequest,
    recordingRefs: facts.recordingRefs,
    tasks: facts.tasks,
    title: facts.title,
    todos: facts.todos.map((todo) => ({
      ...todo,
      status: todo.status as Todo["status"]
    })),
    toolDecisions: facts.toolDecisions
  }
}

export function mapHitlRowToRequest(row: HitlRequestRow): HITLRequest {
  const toolCallId = getRequiredHitlRowToolCallId(row)
  const parsedToolArgs = parseHitlJson(row, "tool_args", row.tool_args)
  if (
    typeof parsedToolArgs !== "object" ||
    parsedToolArgs === null ||
    Array.isArray(parsedToolArgs)
  ) {
    throw new Error(`[RuntimeState] HITL request "${row.request_id}" has invalid tool_args.`)
  }

  const parsedAllowedDecisions = parseHitlJson(row, "allowed_decisions", row.allowed_decisions)
  if (
    !Array.isArray(parsedAllowedDecisions) ||
    parsedAllowedDecisions.length === 0 ||
    !parsedAllowedDecisions.every(isHitlDecisionType)
  ) {
    throw new Error(
      `[RuntimeState] HITL request "${row.request_id}" has invalid allowed_decisions.`
    )
  }

  const reviewPayload = row.review_payload
    ? parseHitlJson(row, "review_payload", row.review_payload)
    : null
  const review = parseToolApprovalItem(reviewPayload)
  if (reviewPayload !== null && review === null) {
    throw new Error(`[RuntimeState] HITL request "${row.request_id}" has invalid review_payload.`)
  }

  return {
    id: row.request_id,
    tool_call: {
      id: toolCallId,
      name: row.tool_name,
      args: parsedToolArgs as Record<string, unknown>
    },
    allowed_decisions: parsedAllowedDecisions,
    review
  }
}
