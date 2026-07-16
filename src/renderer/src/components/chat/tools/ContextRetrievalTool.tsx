import { MessageSquareText } from "lucide-react"
import {
  parseContextRetrievalToolResult,
  type ContextRetrievalNextAction,
  type ContextRetrievalToolResult,
  type MessageContextToolResult,
  type SearchHistoryToolResult,
  type TraceEvidenceToolResult
} from "@shared/context-retrieval-results"
import { defineToolComponent } from "./registry-core"
import { joinSummaryParts, projectRequiredStringArg, truncateMiddle } from "./shared"
import {
  ToolCodeBlock,
  ToolCollapsibleSection,
  ToolContractNotice,
  ToolDetailSection,
  ToolDetailStack,
  ToolDetailText,
  ToolPreviewLines
} from "./shared-components"
import type { ToolComponentStatus } from "./types"

type ContextRetrievalResultProjection =
  | { kind: "absent" }
  | { kind: "error"; text: string }
  | { field: "result"; kind: "invalid" }
  | { kind: "ready"; result: ContextRetrievalToolResult }

type ContextRetrievalToolName = "get_message_context" | "get_trace_evidence" | "search_history"

function readRequestIdentity(args: Record<string, unknown>, field: string): string | null {
  const value = args[field]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function isCanonicalEmptyUnavailableTraceEvidenceResult(result: TraceEvidenceToolResult): boolean {
  return (
    result.status === "unavailable" &&
    result.artifacts.length === 0 &&
    result.step === null &&
    result.blobs.input === null &&
    result.blobs.output === null &&
    Object.values(result.trace).every((value) => value === null)
  )
}

function traceEvidenceMatchesRequest(
  args: Record<string, unknown>,
  result: TraceEvidenceToolResult
): boolean {
  if (isCanonicalEmptyUnavailableTraceEvidenceResult(result)) {
    return true
  }

  const selectors = {
    artifactId: readRequestIdentity(args, "artifactId"),
    runId: readRequestIdentity(args, "runId"),
    toolCallId: readRequestIdentity(args, "toolCallId"),
    traceId: readRequestIdentity(args, "traceId"),
    traceStepId: readRequestIdentity(args, "traceStepId")
  }
  if (!Object.values(selectors).some(Boolean)) {
    return false
  }

  return (
    (!selectors.traceStepId || result.step?.traceStepId === selectors.traceStepId) &&
    (!selectors.traceId || result.trace.traceId === selectors.traceId) &&
    (!selectors.runId || result.trace.runId === selectors.runId) &&
    (!selectors.toolCallId || result.step?.toolCallId === selectors.toolCallId) &&
    (!selectors.artifactId ||
      result.artifacts.some((artifact) => artifact.artifactId === selectors.artifactId))
  )
}

function contextRetrievalResultMatchesRequest(input: {
  args: Record<string, unknown>
  result: ContextRetrievalToolResult
  toolName: ContextRetrievalToolName
}): boolean {
  switch (input.toolName) {
    case "search_history":
      return (
        input.result.kind === "history_search" &&
        input.result.query === readRequestIdentity(input.args, "query")
      )
    case "get_message_context":
      return (
        input.result.kind === "message_context" &&
        input.result.focus.messageId === readRequestIdentity(input.args, "messageId") &&
        input.result.focus.threadId === readRequestIdentity(input.args, "threadId")
      )
    case "get_trace_evidence":
      return (
        input.result.kind === "trace_evidence" &&
        traceEvidenceMatchesRequest(input.args, input.result)
      )
  }
}

function projectContextRetrievalResult(input: {
  args: Record<string, unknown>
  rawResult: string
  result: unknown
  status: ToolComponentStatus
  toolName: ContextRetrievalToolName
}): ContextRetrievalResultProjection {
  if (input.status === "failed") {
    return input.rawResult.trim()
      ? { kind: "error", text: input.rawResult }
      : { field: "result", kind: "invalid" }
  }

  const result = parseContextRetrievalToolResult(input.result)
  if (
    result &&
    contextRetrievalResultMatchesRequest({
      args: input.args,
      result,
      toolName: input.toolName
    })
  ) {
    return { kind: "ready", result }
  }

  return input.status === "complete" ? { field: "result", kind: "invalid" } : { kind: "absent" }
}

function renderDiagnostics(diagnostics: string[] | undefined): React.JSX.Element | null {
  if (!diagnostics || diagnostics.length === 0) {
    return null
  }

  return (
    <ToolDetailSection label="Diagnostics">
      <div className="grid gap-[var(--jingle-gap-xs)]">
        {diagnostics.map((diagnostic) => (
          <div key={diagnostic} className="break-words text-muted-foreground">
            {diagnostic}
          </div>
        ))}
      </div>
    </ToolDetailSection>
  )
}

function renderNextActions(actions: ContextRetrievalNextAction[]): React.JSX.Element | null {
  if (actions.length === 0) {
    return null
  }

  return (
    <ToolDetailSection label="Next Actions">
      <div className="grid gap-[var(--jingle-gap-xs)]">
        {actions.map((action, index) => (
          <div
            key={`${action.tool}-${index}`}
            className="grid gap-[var(--jingle-space-0-5)] rounded-[var(--jingle-radius-dialog)] bg-background-secondary/45 px-[var(--jingle-space-3)] py-[var(--jingle-space-2)]"
          >
            <div className="font-mono [font-size:var(--jingle-font-code)] text-foreground/80">
              {action.tool}
            </div>
            <div className="break-words text-muted-foreground">{action.reason}</div>
          </div>
        ))}
      </div>
    </ToolDetailSection>
  )
}

function renderHistorySearchDetail(result: SearchHistoryToolResult): React.JSX.Element {
  return (
    <ToolDetailStack>
      <ToolDetailSection label="Summary">
        <div className="break-words text-foreground/80">{result.summary}</div>
      </ToolDetailSection>
      {renderDiagnostics(result.diagnostics)}
      <ToolDetailSection label="Matches">
        <div className="grid gap-[var(--jingle-space-2)]">
          {result.items.map((item) =>
            item.type === "thread_digest" ? (
              <ToolCollapsibleSection
                key={`thread:${item.threadId}`}
                label="Thread Digest"
                summary={joinSummaryParts(item.title, `${item.messageCount} messages`)}
              >
                <ToolPreviewLines text={item.summary} maxLines={8} />
              </ToolCollapsibleSection>
            ) : (
              <ToolCollapsibleSection
                key={`message:${item.threadId}:${item.messageId}`}
                label={`${item.role} Message`}
                summary={joinSummaryParts(
                  truncateMiddle(item.threadId, 28),
                  truncateMiddle(item.messageId, 28)
                )}
              >
                <ToolPreviewLines text={item.snippet} maxLines={8} />
              </ToolCollapsibleSection>
            )
          )}
        </div>
      </ToolDetailSection>
      {renderNextActions(result.nextActions)}
    </ToolDetailStack>
  )
}

function renderMessageContextDetail(result: MessageContextToolResult): React.JSX.Element {
  return (
    <ToolDetailStack>
      <ToolDetailSection label="Summary">
        <div className="break-words text-foreground/80">{result.summary}</div>
      </ToolDetailSection>
      {renderDiagnostics(result.diagnostics)}
      <ToolDetailSection label="Transcript">
        <div className="grid gap-[var(--jingle-space-2)]">
          {result.items.map((item) => (
            <ToolCollapsibleSection
              key={`${item.threadId}:${item.messageId}`}
              label={`${item.role} Message`}
              summary={joinSummaryParts(
                truncateMiddle(item.threadId, 28),
                truncateMiddle(item.messageId, 28),
                item.toolCalls.length > 0 ? `${item.toolCalls.length} tool calls` : null
              )}
            >
              <ToolPreviewLines text={item.text} maxLines={10} />
            </ToolCollapsibleSection>
          ))}
        </div>
      </ToolDetailSection>
      {renderNextActions(result.nextActions)}
    </ToolDetailStack>
  )
}

function renderTraceEvidenceDetail(result: TraceEvidenceToolResult): React.JSX.Element {
  return (
    <ToolDetailStack>
      <ToolDetailSection label="Summary">
        <div className="break-words text-foreground/80">{result.summary}</div>
      </ToolDetailSection>
      {renderDiagnostics(result.diagnostics)}
      <ToolDetailSection label="Trace">
        <ToolCodeBlock>
          {[
            result.trace.traceId ? `traceId: ${result.trace.traceId}` : null,
            result.trace.runId ? `runId: ${result.trace.runId}` : null,
            result.trace.threadId ? `threadId: ${result.trace.threadId}` : null,
            result.trace.model ? `model: ${result.trace.model}` : null,
            result.trace.provider ? `provider: ${result.trace.provider}` : null,
            result.trace.status ? `status: ${result.trace.status}` : null,
            result.step ? `step: ${result.step.traceStepId}` : null,
            result.step?.toolName ? `tool: ${result.step.toolName}` : null,
            result.step?.toolCallId ? `toolCallId: ${result.step.toolCallId}` : null
          ]
            .filter((line): line is string => typeof line === "string")
            .join("\n")}
        </ToolCodeBlock>
      </ToolDetailSection>
      {result.blobs.input ? (
        <ToolCollapsibleSection label="Input Blob" summary={result.blobs.input.preview}>
          <ToolPreviewLines text={result.blobs.input.text} maxLines={10} />
        </ToolCollapsibleSection>
      ) : null}
      {result.blobs.output ? (
        <ToolCollapsibleSection label="Output Blob" summary={result.blobs.output.preview}>
          <ToolPreviewLines text={result.blobs.output.text} maxLines={10} />
        </ToolCollapsibleSection>
      ) : null}
      {result.artifacts.length > 0 ? (
        <ToolDetailSection label="Artifacts">
          <div className="grid gap-[var(--jingle-space-2)]">
            {result.artifacts.map((artifact) => (
              <ToolCollapsibleSection
                key={artifact.artifactId}
                label={artifact.kind}
                summary={joinSummaryParts(
                  artifact.title,
                  truncateMiddle(artifact.artifactId, 28),
                  artifact.status
                )}
              >
                {artifact.preview ? (
                  <ToolPreviewLines text={artifact.preview} maxLines={8} />
                ) : null}
              </ToolCollapsibleSection>
            ))}
          </div>
        </ToolDetailSection>
      ) : null}
      {renderNextActions(result.nextActions)}
    </ToolDetailStack>
  )
}

function renderContextRetrievalDetail(result: ContextRetrievalToolResult): React.JSX.Element {
  switch (result.kind) {
    case "history_search":
      return renderHistorySearchDetail(result)
    case "message_context":
      return renderMessageContextDetail(result)
    case "trace_evidence":
      return renderTraceEvidenceDetail(result)
  }
}

function renderContextRetrievalProjection(
  copy: Parameters<typeof ToolContractNotice>[0]["copy"],
  projection: ContextRetrievalResultProjection
): React.JSX.Element | null {
  switch (projection.kind) {
    case "absent":
      return null
    case "error":
      return <ToolDetailText>{projection.text}</ToolDetailText>
    case "invalid":
      return <ToolContractNotice copy={copy} field={projection.field} />
    case "ready":
      return renderContextRetrievalDetail(projection.result)
  }
}

function renderContextToolDetail(input: {
  copy: Parameters<typeof ToolContractNotice>[0]["copy"]
  invalidField: string | null
  result: ContextRetrievalResultProjection
}): React.JSX.Element | null {
  const resultDetail = renderContextRetrievalProjection(input.copy, input.result)
  if (!input.invalidField && !resultDetail) {
    return null
  }

  return (
    <>
      {input.invalidField ? (
        <ToolContractNotice copy={input.copy} field={input.invalidField} />
      ) : null}
      {resultDetail}
    </>
  )
}

defineToolComponent({
  name: "search_history",
  icon: MessageSquareText,
  project({ args, rawResult, result, status }) {
    const query = projectRequiredStringArg(args, "query", status === "arguments_streaming")
    return {
      invalidField: query.kind === "invalid" ? query.field : null,
      queryDetail: query.kind === "ready" ? truncateMiddle(query.value, 60) : null,
      retrievalResult: projectContextRetrievalResult({
        args,
        rawResult,
        result,
        status,
        toolName: "search_history"
      })
    }
  },
  hasDetail({ viewModel }) {
    return Boolean(viewModel.invalidField) || viewModel.retrievalResult.kind !== "absent"
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.queryDetail,
      title: copy.toolCall.labels.search_history
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderContextToolDetail({
      copy,
      invalidField: viewModel.invalidField,
      result: viewModel.retrievalResult
    })
  }
})

defineToolComponent({
  name: "get_message_context",
  icon: MessageSquareText,
  project({ args, rawResult, result, status }) {
    const isStreaming = status === "arguments_streaming"
    const messageId = projectRequiredStringArg(args, "messageId", isStreaming)
    const threadId = projectRequiredStringArg(args, "threadId", isStreaming)
    const invalidFields = [messageId, threadId]
      .filter((field) => field.kind === "invalid")
      .map((field) => field.field)

    return {
      detail: joinSummaryParts(
        threadId.kind === "ready" ? truncateMiddle(threadId.value, 28) : null,
        messageId.kind === "ready" ? truncateMiddle(messageId.value, 36) : null
      ),
      invalidField: invalidFields.length > 0 ? invalidFields.join("|") : null,
      retrievalResult: projectContextRetrievalResult({
        args,
        rawResult,
        result,
        status,
        toolName: "get_message_context"
      })
    }
  },
  hasDetail({ viewModel }) {
    return Boolean(viewModel.invalidField) || viewModel.retrievalResult.kind !== "absent"
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.get_message_context
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderContextToolDetail({
      copy,
      invalidField: viewModel.invalidField,
      result: viewModel.retrievalResult
    })
  }
})

defineToolComponent({
  name: "get_trace_evidence",
  icon: MessageSquareText,
  project({ args, rawResult, result, status }) {
    const primarySelector = ["traceStepId", "toolCallId", "traceId", "runId"]
      .map((field) => (typeof args[field] === "string" ? args[field].trim() : ""))
      .find(Boolean)
    const artifactId = typeof args.artifactId === "string" ? args.artifactId.trim() : ""
    const detail = joinSummaryParts(
      primarySelector ? truncateMiddle(primarySelector, 36) : null,
      artifactId ? truncateMiddle(artifactId, 36) : null
    )

    return {
      detail: detail || null,
      invalidField:
        primarySelector || artifactId || status === "arguments_streaming"
          ? null
          : "traceStepId|toolCallId|traceId|runId|artifactId",
      retrievalResult: projectContextRetrievalResult({
        args,
        rawResult,
        result,
        status,
        toolName: "get_trace_evidence"
      })
    }
  },
  hasDetail({ viewModel }) {
    return Boolean(viewModel.invalidField) || viewModel.retrievalResult.kind !== "absent"
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.get_trace_evidence
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderContextToolDetail({
      copy,
      invalidField: viewModel.invalidField,
      result: viewModel.retrievalResult
    })
  }
})
