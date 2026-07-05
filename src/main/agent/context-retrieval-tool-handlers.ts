import {
  createRetrievedArtifactContextInclusion,
  createRetrievedMessageContextInclusion,
  createRetrievedTraceStepContextInclusion,
  createRetrievedThreadDigestContextInclusion,
  type AgentContextInclusion
} from "@shared/jingle-memory"
import {
  serializeContextRetrievalToolResult,
  type ContextRetrievalNextAction,
  type MessageContextResultItem,
  type RetrievedHistoryMessageResultItem,
  type SearchHistoryToolResult,
  type TraceArtifactResultItem,
  type TraceBlobResult,
  type TraceEvidenceToolResult
} from "@shared/context-retrieval-results"
import type { ArtifactRecord } from "@shared/artifacts"
import type { ThreadDigestSearchMatch } from "@shared/thread-digest"
import { extractMessageText } from "@shared/message-content"
import {
  listProjectedThreadMessages,
  searchProjectedThreadMessages,
  type MessageProjectionRow
} from "../db/message-state"
import {
  formatAgentTraceStepId,
  getAgentTrace,
  getAgentTraceBlob,
  getAgentTraceByRunId,
  getAgentTraceStep,
  getAgentTraceStepByToolCallId,
  parseAgentTraceStepId,
  type AgentTraceBlobRow,
  type AgentTraceStepRow,
  type AgentTraceSummaryRow
} from "../db/agent-traces"
import { searchThreadDigests } from "../db/thread-digests"
import { getArtifact, listArtifactsByToolCallId } from "../artifacts/service"
import type { RuntimeContextRetrievalConfig } from "@jingle/langchain-agent-harness"
import {
  jingleSearchHistoryInputSchema
} from "@jingle/langchain-agent-harness/transitional"

const TOOL_CONTEXT_CONTENT_LIMIT = 4_000
const MESSAGE_CONTEXT_ENTRY_CONTENT_LIMIT = 1_200
const TRACE_EVIDENCE_BLOB_CONTENT_LIMIT = 2_000
const ARTIFACT_EVIDENCE_CONTENT_LIMIT = 2_000

type AgentContextInclusionToolHandlers = RuntimeContextRetrievalConfig<AgentContextInclusion>

function readProjectedMessageText(message: MessageProjectionRow): string {
  let content: unknown = message.content
  try {
    content = JSON.parse(message.content) as unknown
  } catch {
    content = message.content
  }

  const text =
    typeof content === "string" || Array.isArray(content) ? extractMessageText(content) : ""
  return text.trim() || message.content
}

function clipToolContextContent(content: string, limit = TOOL_CONTEXT_CONTENT_LIMIT): string {
  const trimmed = content.trim()
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit)}\n[truncated]`
    : trimmed
}

function parseProjectedToolCalls(
  message: MessageProjectionRow
): Array<{ id: string; name: string }> {
  if (!message.tool_calls) {
    return []
  }

  const parsed = JSON.parse(message.tool_calls) as unknown
  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.flatMap((toolCall) => {
    if (
      !toolCall ||
      typeof toolCall !== "object" ||
      typeof (toolCall as { id?: unknown }).id !== "string" ||
      typeof (toolCall as { name?: unknown }).name !== "string"
    ) {
      return []
    }

    return [
      {
        id: (toolCall as { id: string }).id,
        name: (toolCall as { name: string }).name
      }
    ]
  })
}

function createHistoryMessageResultItem(input: {
  message: MessageProjectionRow
  snippet: string
}): RetrievedHistoryMessageResultItem {
  return {
    messageId: input.message.message_id,
    role: input.message.role,
    runId: input.message.run_id,
    snippet: clipToolContextContent(input.snippet, MESSAGE_CONTEXT_ENTRY_CONTENT_LIMIT),
    threadId: input.message.thread_id,
    toolCallId: input.message.tool_call_id,
    toolCalls: parseProjectedToolCalls(input.message),
    type: "history_message"
  }
}

function createMessageContextResultItem(input: {
  message: MessageProjectionRow
  text: string
}): MessageContextResultItem {
  return {
    messageId: input.message.message_id,
    role: input.message.role,
    runId: input.message.run_id,
    text: clipToolContextContent(input.text, MESSAGE_CONTEXT_ENTRY_CONTENT_LIMIT),
    threadId: input.message.thread_id,
    toolCallId: input.message.tool_call_id,
    toolCalls: parseProjectedToolCalls(input.message)
  }
}

function createMessageContextNextActions(
  items: RetrievedHistoryMessageResultItem[]
): ContextRetrievalNextAction[] {
  return items.slice(0, 5).map((item) => ({
    args: {
      after: 2,
      before: 2,
      messageId: item.messageId,
      threadId: item.threadId
    },
    reason: `Expand transcript context around ${item.threadId}/${item.messageId}.`,
    tool: "get_message_context"
  }))
}

function createTraceEvidenceNextActions(
  items: MessageContextResultItem[]
): ContextRetrievalNextAction[] {
  const actions: ContextRetrievalNextAction[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const candidates = [
      ...(item.toolCallId ? [{ id: item.toolCallId, name: null as string | null }] : []),
      ...item.toolCalls
    ]

    for (const candidate of candidates) {
      const key = `${item.runId ?? ""}:${candidate.id}`
      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      actions.push({
        args: {
          ...(item.runId ? { runId: item.runId } : {}),
          toolCallId: candidate.id
        },
        reason: `Inspect execution evidence for ${candidate.name ?? candidate.id}.`,
        tool: "get_trace_evidence"
      })
    }
  }

  return actions.slice(0, 5)
}

function formatRetrievedMessageToolContent(input: {
  after: number
  before: number
  focusMessageId: string
  messages: Array<{ message: MessageProjectionRow; text: string }>
  threadId: string
}): string {
  const items = input.messages.map(createMessageContextResultItem)
  const focus = items.find((item) => item.messageId === input.focusMessageId)

  return serializeContextRetrievalToolResult({
    focus: {
      messageId: input.focusMessageId,
      runId: focus?.runId ?? null,
      threadId: input.threadId
    },
    items,
    kind: "message_context",
    nextActions: createTraceEvidenceNextActions(items),
    status: items.length > 0 ? "ok" : "empty",
    summary:
      items.length > 0
        ? `Loaded ${items.length} messages around ${input.threadId}/${input.focusMessageId}.`
        : `No projected messages found around ${input.threadId}/${input.focusMessageId}.`,
    window: {
      after: input.after,
      before: input.before
    }
  })
}

function formatRetrievedHistoryToolContent(
  input: {
    digests: ThreadDigestSearchMatch[]
    messages: Array<{ message: MessageProjectionRow; text: string }>
    query: string
  }
): string {
  const messageItems = input.messages.map(({ message, text }) =>
    createHistoryMessageResultItem({ message, snippet: text })
  )
  const result: SearchHistoryToolResult = {
    diagnostics:
      input.digests.length === 0 && input.messages.length > 0
        ? ["No thread digest matches; searched message FTS directly."]
        : undefined,
    items: [
      ...input.digests.map((digest) => ({
        messageCount: digest.messageCount,
        summary: clipToolContextContent(digest.summary ?? "", TOOL_CONTEXT_CONTENT_LIMIT),
        threadId: digest.threadId,
        title: digest.threadTitle,
        type: "thread_digest" as const
      })),
      ...messageItems
    ],
    kind: "history_search",
    nextActions: createMessageContextNextActions(messageItems),
    query: input.query,
    status: input.digests.length > 0 || input.messages.length > 0 ? "ok" : "empty",
    summary:
      input.digests.length > 0 || input.messages.length > 0
        ? `Found ${input.digests.length} thread digest match(es) and ${input.messages.length} history message match(es).`
        : "No matching history context found."
  }

  return serializeContextRetrievalToolResult(result)
}

function createTraceBlobResult(blob: AgentTraceBlobRow | null): TraceBlobResult | null {
  if (!blob) {
    return null
  }

  return {
    kind: blob.kind,
    preview: blob.preview,
    sizeBytes: blob.size_bytes,
    text: clipToolContextContent(blob.value, TRACE_EVIDENCE_BLOB_CONTENT_LIMIT)
  }
}

function createTraceArtifactResultItem(input: {
  artifact: ArtifactRecord
  content: string | null
}): TraceArtifactResultItem {
  return {
    artifactId: input.artifact.id,
    kind: input.artifact.kind,
    preview: input.content
      ? clipToolContextContent(input.content, ARTIFACT_EVIDENCE_CONTENT_LIMIT)
      : input.artifact.previewText,
    runId: input.artifact.runId,
    status: input.artifact.status,
    threadId: input.artifact.threadId,
    title: input.artifact.title,
    toolCallId: input.artifact.toolCallId
  }
}

function formatRetrievedTraceEvidenceToolContent(input: {
  artifactSummaries: Array<{ content: string | null; record: ArtifactRecord }>
  inputBlob: AgentTraceBlobRow | null
  outputBlob: AgentTraceBlobRow | null
  step: AgentTraceStepRow
  trace: AgentTraceSummaryRow
}): string {
  return serializeContextRetrievalToolResult({
    artifacts: input.artifactSummaries.map((artifact) =>
      createTraceArtifactResultItem({
        artifact: artifact.record,
        content: artifact.content
      })
    ),
    blobs: {
      input: createTraceBlobResult(input.inputBlob),
      output: createTraceBlobResult(input.outputBlob)
    },
    kind: "trace_evidence",
    nextActions: [],
    status: "ok",
    step: {
      durationMs: input.step.duration_ms,
      status: input.step.status,
      stepIndex: input.step.step_index,
      stepType: input.step.step_type,
      toolCallId: input.step.tool_call_id,
      toolName: input.step.tool_name,
      traceStepId: formatAgentTraceStepId(input.step.trace_id, input.step.step_index)
    },
    summary: `Loaded ${input.step.step_type} trace step ${formatAgentTraceStepId(
      input.step.trace_id,
      input.step.step_index
    )}.`,
    trace: {
      model: input.trace.model,
      provider: input.trace.provider,
      runId: input.trace.run_id,
      status: input.trace.status,
      threadId: input.trace.thread_id,
      traceId: input.trace.trace_id
    }
  })
}

function readArtifactEvidenceText(artifact: ArtifactRecord): string | null {
  if (artifact.kind === "summary" || artifact.kind === "patch") {
    return artifact.payload?.text ?? artifact.previewText
  }

  return artifact.previewText
}

function formatRetrievedArtifactToolContent(input: {
  artifact: ArtifactRecord
  content: string | null
}): string {
  return serializeContextRetrievalToolResult({
    artifacts: [
      createTraceArtifactResultItem({
        artifact: input.artifact,
        content: input.content
      })
    ],
    blobs: {
      input: null,
      output: null
    },
    kind: "trace_evidence",
    nextActions: [],
    status: "ok",
    step: null,
    summary: `Loaded artifact evidence ${input.artifact.id}.`,
    trace: {
      model: null,
      provider: null,
      runId: input.artifact.runId,
      status: null,
      threadId: input.artifact.threadId,
      traceId: null
    }
  })
}

function formatUnavailableMessageContextToolContent(input: {
  after: number
  before: number
  messageId: string
  threadId: string
}): string {
  return serializeContextRetrievalToolResult({
    diagnostics: [`Projected message is unavailable: ${input.threadId}/${input.messageId}.`],
    focus: {
      messageId: input.messageId,
      runId: null,
      threadId: input.threadId
    },
    items: [],
    kind: "message_context",
    nextActions: [],
    status: "empty",
    summary: `Message context not found: ${input.threadId}/${input.messageId}.`,
    window: {
      after: input.after,
      before: input.before
    }
  })
}

function formatUnavailableTraceEvidenceToolContent(input: {
  artifacts?: Array<{ content: string | null; record: ArtifactRecord }>
  diagnostics: string[]
  summary: string
  trace?: AgentTraceSummaryRow | null
}): string {
  const result: TraceEvidenceToolResult = {
    artifacts:
      input.artifacts?.map((artifact) =>
        createTraceArtifactResultItem({
          artifact: artifact.record,
          content: artifact.content
        })
      ) ?? [],
    blobs: {
      input: null,
      output: null
    },
    diagnostics: input.diagnostics,
    kind: "trace_evidence",
    nextActions: [],
    status: "unavailable",
    step: null,
    summary: input.summary,
    trace: {
      model: input.trace?.model ?? null,
      provider: input.trace?.provider ?? null,
      runId: input.trace?.run_id ?? null,
      status: input.trace?.status ?? null,
      threadId: input.trace?.thread_id ?? null,
      traceId: input.trace?.trace_id ?? null
    }
  }

  return serializeContextRetrievalToolResult(result)
}

function artifactMatchesTraceSource(
  artifact: ArtifactRecord,
  trace: AgentTraceSummaryRow
): boolean {
  return (
    (artifact.runId === trace.run_id && artifact.threadId === trace.thread_id)
  )
}

async function searchHistoryMessages(input: {
  limit: number
  query: string
  threadIds: string[]
}): Promise<MessageProjectionRow[]> {
  if (input.threadIds.length === 0) {
    return searchProjectedThreadMessages({
      limit: input.limit,
      query: input.query
    })
  }

  const perThreadLimit = Math.max(input.limit, 1)
  const results = await Promise.all(
    input.threadIds.map((threadId) =>
      searchProjectedThreadMessages({
        limit: perThreadLimit,
        query: input.query,
        threadId
      })
    )
  )
  const seen = new Set<string>()
  const messages: MessageProjectionRow[] = []

  for (const threadMatches of results) {
    for (const message of threadMatches) {
      const key = `${message.thread_id}:${message.message_id}`
      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      messages.push(message)
      if (messages.length >= input.limit) {
        return messages
      }
    }
  }

  return messages
}

function getProjectedMessageWindow(input: {
  after: number
  before: number
  focusMessageId: string
  messages: MessageProjectionRow[]
}): MessageProjectionRow[] {
  const focusIndex = input.messages.findIndex(
    (message) => message.message_id === input.focusMessageId
  )
  if (focusIndex < 0) {
    return []
  }

  const start = Math.max(focusIndex - input.before, 0)
  const end = Math.min(focusIndex + input.after + 1, input.messages.length)
  return input.messages.slice(start, end)
}

function traceStepPreview(input: {
  inputBlob: AgentTraceBlobRow | null
  outputBlob: AgentTraceBlobRow | null
  step: AgentTraceStepRow
}): string {
  const blobPreview =
    input.outputBlob?.preview ??
    input.inputBlob?.preview ??
    input.outputBlob?.value ??
    input.inputBlob?.value ??
    input.step.error_message
  const label = input.step.tool_name ?? input.step.step_type
  return blobPreview ? `${label}: ${blobPreview}` : label
}

async function resolveTraceEvidenceSelection(input: {
  artifactId?: string
  runId?: string
  toolCallId?: string
  traceId?: string
  traceStepId?: string
}): Promise<
  | {
      artifactOnly: true
      trace: null
      step: null
    }
  | {
      artifactOnly: false
      trace: AgentTraceSummaryRow | null
      step: AgentTraceStepRow | null
    }
> {
  if (input.traceStepId) {
    const parsed = parseAgentTraceStepId(input.traceStepId)
    if (!parsed) {
      return { artifactOnly: false, step: null, trace: null }
    }

    const step = await getAgentTraceStep(parsed.traceId, parsed.stepIndex)
    const trace = step ? await getAgentTrace(parsed.traceId) : null
    return { artifactOnly: false, step, trace }
  }

  if (input.toolCallId) {
    const step = await getAgentTraceStepByToolCallId({
      runId: input.runId,
      toolCallId: input.toolCallId,
      traceId: input.traceId
    })
    const trace = step ? await getAgentTrace(step.trace_id) : null
    return { artifactOnly: false, step, trace }
  }

  if (input.traceId) {
    const trace = await getAgentTrace(input.traceId)
    if (!trace || trace.total_steps <= 0) {
      return { artifactOnly: false, step: null, trace }
    }

    const step = await getAgentTraceStep(trace.trace_id, 0)
    return { artifactOnly: false, step, trace }
  }

  if (input.runId) {
    const trace = await getAgentTraceByRunId(input.runId)
    if (!trace || trace.total_steps <= 0) {
      return { artifactOnly: false, step: null, trace }
    }

    const step = await getAgentTraceStep(trace.trace_id, 0)
    return { artifactOnly: false, step, trace }
  }

  return { artifactOnly: true, step: null, trace: null }
}

export function createAgentContextInclusionToolHandlers(options: {
  threadId: string
}): AgentContextInclusionToolHandlers {
  return {
    getMessageContext: async (parsed, context) => {
      const targetThreadId = parsed.threadId
      const before = parsed.before ?? 2
      const after = parsed.after ?? 2
      const messages = await listProjectedThreadMessages(targetThreadId)
      const windowMessages = getProjectedMessageWindow({
        after,
        before,
        focusMessageId: parsed.messageId,
        messages
      })
      const message = windowMessages.find((entry) => entry.message_id === parsed.messageId)

      if (!message) {
        return {
          content: formatUnavailableMessageContextToolContent({
            after,
            before,
            messageId: parsed.messageId,
            threadId: targetThreadId
          })
        }
      }

      const messageText = readProjectedMessageText(message)
      const windowEntries = windowMessages.map((entry) => ({
        message: entry,
        text: readProjectedMessageText(entry)
      }))
      const inclusion = createRetrievedMessageContextInclusion({
        createdAt: Date.now(),
        message: {
          content: messageText,
          id: message.message_id,
          role: message.role,
          threadId: targetThreadId
        },
        runId: context.runId,
        threadId: options.threadId
      })

      return {
        content: formatRetrievedMessageToolContent({
          after,
          before,
          focusMessageId: parsed.messageId,
          messages: windowEntries,
          threadId: targetThreadId
        }),
        contextInclusions: [inclusion]
      }
    },
    searchHistory: async (parsed, context) => {
      const limit = parsed.limit ?? 8
      const digestMatches = await searchThreadDigests({
        limit,
        query: parsed.query,
        threadId: parsed.threadId
      })
      const routedThreadIds = digestMatches.map((digest) => digest.threadId)
      const matches = await searchHistoryMessages({
        limit,
        query: parsed.query,
        threadIds: parsed.threadId ? [parsed.threadId] : routedThreadIds
      })

      if (digestMatches.length === 0 && matches.length === 0) {
        return {
          content: formatRetrievedHistoryToolContent({
            digests: [],
            messages: [],
            query: parsed.query
          })
        }
      }

      const createdAt = Date.now()
      const retrievedMessages = matches.map((message) => ({
        message,
        text: readProjectedMessageText(message)
      }))
      const inclusions = retrievedMessages.map(({ message, text }) =>
        createRetrievedMessageContextInclusion({
          createdAt,
          message: {
            content: text,
            id: message.message_id,
            role: message.role,
            threadId: message.thread_id
          },
          runId: context.runId,
          threadId: options.threadId
        })
      )
      const digestInclusions = digestMatches.map((digest) =>
        createRetrievedThreadDigestContextInclusion({
          createdAt,
          digest: {
            preview: digest.summary ?? "",
            threadId: digest.threadId,
            title: digest.threadTitle
          },
          runId: context.runId,
          threadId: options.threadId
        })
      )

      return {
        content: formatRetrievedHistoryToolContent({
          digests: digestMatches,
          messages: retrievedMessages,
          query: parsed.query
        }),
        contextInclusions: [...digestInclusions, ...inclusions]
      }
    },
    getTraceEvidence: async (parsed, context) => {
      const createdAt = Date.now()
      const selection = await resolveTraceEvidenceSelection({
        artifactId: parsed.artifactId,
        runId: parsed.runId,
        toolCallId: parsed.toolCallId,
        traceId: parsed.traceId,
        traceStepId: parsed.traceStepId
      })
      const explicitArtifact = parsed.artifactId ? await getArtifact(parsed.artifactId) : null
      const scopedExplicitArtifact =
        selection.artifactOnly || !explicitArtifact
          ? explicitArtifact
          : selection.trace && artifactMatchesTraceSource(explicitArtifact, selection.trace)
            ? explicitArtifact
            : null
      const linkedArtifactRunId =
        parsed.runId ?? (!selection.artifactOnly && selection.trace ? selection.trace.run_id : undefined)
      const linkedArtifacts =
        parsed.artifactId || !parsed.toolCallId
          ? scopedExplicitArtifact
            ? [scopedExplicitArtifact]
            : []
          : await listArtifactsByToolCallId({
              runId: linkedArtifactRunId,
              toolCallId: parsed.toolCallId
            })
      const linkedArtifactEvidence = linkedArtifacts.map((artifact) => ({
        content: readArtifactEvidenceText(artifact),
        record: artifact
      }))

      if (selection.artifactOnly) {
        if (!explicitArtifact) {
          return {
            content: formatUnavailableTraceEvidenceToolContent({
              diagnostics: [`Artifact is unavailable: ${parsed.artifactId}.`],
              summary: `Artifact evidence not found: ${parsed.artifactId}.`
            })
          }
        }

        const explicitArtifactContent = readArtifactEvidenceText(explicitArtifact)
        const artifactInclusion = createRetrievedArtifactContextInclusion({
          artifact: {
            artifactId: explicitArtifact.id,
            kind: explicitArtifact.kind,
            preview: explicitArtifactContent ?? explicitArtifact.title,
            runId: explicitArtifact.runId,
            threadId: explicitArtifact.threadId,
            title: explicitArtifact.title,
            toolCallId: explicitArtifact.toolCallId
          },
          createdAt,
          runId: context.runId,
          threadId: options.threadId
        })

        return {
          content: formatRetrievedArtifactToolContent({
            artifact: explicitArtifact,
            content: explicitArtifactContent
          }),
          contextInclusions: [artifactInclusion]
        }
      }

      if (!selection.trace) {
        return {
          content: formatUnavailableTraceEvidenceToolContent({
            artifacts: linkedArtifactEvidence,
            diagnostics: ["Trace projection is unavailable for the requested selector."],
            summary: "Trace evidence not found."
          })
        }
      }

      if (!selection.step) {
        return {
          content: formatUnavailableTraceEvidenceToolContent({
            artifacts: linkedArtifactEvidence,
            diagnostics: [`Trace step is unavailable in trace ${selection.trace.trace_id}.`],
            summary: `Trace step evidence not found: ${selection.trace.trace_id}.`,
            trace: selection.trace
          })
        }
      }

      const includeInput = parsed.includeInput ?? true
      const includeOutput = parsed.includeOutput ?? true
      const inputBlob = includeInput ? await getAgentTraceBlob(selection.step.input_blob_id) : null
      const outputBlob = includeOutput ? await getAgentTraceBlob(selection.step.output_blob_id) : null

      if (includeInput && selection.step.input_blob_id && !inputBlob) {
        return {
          content: formatUnavailableTraceEvidenceToolContent({
            artifacts: linkedArtifactEvidence,
            diagnostics: [`Trace input blob is unavailable: ${selection.step.input_blob_id}.`],
            summary: `Trace input blob not found: ${selection.step.input_blob_id}.`,
            trace: selection.trace
          })
        }
      }

      if (includeOutput && selection.step.output_blob_id && !outputBlob) {
        return {
          content: formatUnavailableTraceEvidenceToolContent({
            artifacts: linkedArtifactEvidence,
            diagnostics: [`Trace output blob is unavailable: ${selection.step.output_blob_id}.`],
            summary: `Trace output blob not found: ${selection.step.output_blob_id}.`,
            trace: selection.trace
          })
        }
      }

      const traceInclusion = createRetrievedTraceStepContextInclusion({
        createdAt,
        runId: context.runId,
        sourceRunId: selection.trace.run_id,
        sourceThreadId: selection.trace.thread_id,
        step: {
          preview: traceStepPreview({
            inputBlob,
            outputBlob,
            step: selection.step
          }),
          stepIndex: selection.step.step_index,
          stepType: selection.step.step_type,
          toolCallId: selection.step.tool_call_id,
          toolName: selection.step.tool_name,
          traceId: selection.step.trace_id
        },
        threadId: options.threadId
      })
      const artifactInclusions = linkedArtifacts.map((artifact) =>
        createRetrievedArtifactContextInclusion({
          artifact: {
            artifactId: artifact.id,
            kind: artifact.kind,
            preview: readArtifactEvidenceText(artifact) ?? artifact.title,
            runId: artifact.runId,
            threadId: artifact.threadId,
            title: artifact.title,
            toolCallId: artifact.toolCallId
          },
          createdAt,
          runId: context.runId,
          threadId: options.threadId
        })
      )

      return {
        content: formatRetrievedTraceEvidenceToolContent({
          artifactSummaries: linkedArtifactEvidence,
          inputBlob,
          outputBlob,
          step: selection.step,
          trace: selection.trace
        }),
        contextInclusions: [traceInclusion, ...artifactInclusions]
      }
    }
  }
}

export const contextRetrievalToolHandlersInternals = {
  formatRetrievedArtifactToolContent,
  formatRetrievedHistoryToolContent,
  formatRetrievedMessageToolContent,
  formatRetrievedTraceEvidenceToolContent,
  getProjectedMessageWindow,
  searchHistorySchema: jingleSearchHistoryInputSchema
}
