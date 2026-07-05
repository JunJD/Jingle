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
  RuntimeTask
} from "@jingle/langchain-agent-harness"
import type { HitlRequestRow } from "../db"
import type { HITLRequest, Todo } from "../types"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import { getDefaultHitlAllowedDecisions, normalizeHitlAllowedDecisions } from "@shared/hitl"
import { parseToolApprovalItem } from "@shared/tool-approval"
import {
  normalizeComposerMessageRefs,
  toComposerMessageMetadata,
  toDisplayAssistantMessageContent
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

  if (lcSource === "summarization") {
    metadata.lc_source = lcSource
  }

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
    toAssistantDisplayContent: (content, message) =>
      toDisplayAssistantMessageContent(content, message.displayContext),
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
    }))
  }
}

export function mapHitlRowToRequest(row: HitlRequestRow): HITLRequest {
  let toolArgs: Record<string, unknown> = {}
  let allowedDecisions: HITLRequest["allowed_decisions"] = getDefaultHitlAllowedDecisions()
  let review: HITLRequest["review"] = null
  const toolCallId = getRequiredHitlRowToolCallId(row)

  try {
    toolArgs = JSON.parse(row.tool_args) as Record<string, unknown>
  } catch {
    toolArgs = {}
  }

  try {
    allowedDecisions = normalizeHitlAllowedDecisions(JSON.parse(row.allowed_decisions))
  } catch {
    allowedDecisions = getDefaultHitlAllowedDecisions()
  }

  try {
    review = parseToolApprovalItem(row.review_payload ? JSON.parse(row.review_payload) : null)
  } catch {
    review = null
  }

  return {
    id: row.request_id,
    tool_call: {
      id: toolCallId,
      name: row.tool_name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions,
    review
  }
}
