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
import { getQueryArg, joinSummaryParts, truncateMiddle } from "./shared"
import {
  ToolCodeBlock,
  ToolCollapsibleSection,
  ToolDetailSection,
  ToolDetailStack,
  ToolPreviewLines
} from "./shared-components"

function getContextRetrievalResult(input: {
  rawResult: string
  result?: unknown
}): ContextRetrievalToolResult | null {
  return (
    parseContextRetrievalToolResult(input.result) ??
    parseContextRetrievalToolResult(input.rawResult)
  )
}

function renderDiagnostics(diagnostics: string[] | undefined): React.JSX.Element | null {
  if (!diagnostics || diagnostics.length === 0) {
    return null
  }

  return (
    <ToolDetailSection label="Diagnostics">
      <div className="grid gap-[var(--ow-gap-xs)]">
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
      <div className="grid gap-[var(--ow-gap-xs)]">
        {actions.map((action, index) => (
          <div
            key={`${action.tool}-${index}`}
            className="grid gap-[var(--ow-space-0-5)] rounded-[var(--ow-radius-dialog)] bg-background-secondary/45 px-[var(--ow-space-3)] py-[var(--ow-space-2)]"
          >
            <div className="font-mono [font-size:var(--ow-font-code)] text-foreground/80">
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
        <div className="grid gap-[var(--ow-space-2)]">
          {result.items.map((item) =>
            item.type === "thread_digest" ? (
              <ToolCollapsibleSection
                key={`thread:${item.threadId}`}
                label="Thread Digest"
                summary={joinSummaryParts(item.title ?? item.threadId, `${item.messageCount} messages`)}
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
        <div className="grid gap-[var(--ow-space-2)]">
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
          <div className="grid gap-[var(--ow-space-2)]">
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
                {artifact.preview ? <ToolPreviewLines text={artifact.preview} maxLines={8} /> : null}
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

defineToolComponent({
  name: "search_history",
  icon: MessageSquareText,
  hasDetail({ rawResult, result }) {
    return Boolean(getContextRetrievalResult({ rawResult, result }))
  },
  renderDisplay({ copy, args }) {
    const query = getQueryArg(args)

    return {
      detail: query ? truncateMiddle(query, 60) : null,
      title: copy.toolCall.labels.search_history
    }
  },
  renderDetail({ rawResult, result }) {
    const retrievalResult = getContextRetrievalResult({ rawResult, result })
    return retrievalResult ? renderContextRetrievalDetail(retrievalResult) : null
  }
})

defineToolComponent({
  name: "get_message_context",
  icon: MessageSquareText,
  hasDetail({ rawResult, result }) {
    return Boolean(getContextRetrievalResult({ rawResult, result }))
  },
  renderDisplay({ copy, args }) {
    const messageId = typeof args.messageId === "string" ? args.messageId.trim() : ""
    const threadId = typeof args.threadId === "string" ? args.threadId.trim() : ""

    return {
      detail: joinSummaryParts(
        threadId ? truncateMiddle(threadId, 28) : null,
        messageId ? truncateMiddle(messageId, 36) : null
      ),
      title: copy.toolCall.labels.get_message_context
    }
  },
  renderDetail({ rawResult, result }) {
    const retrievalResult = getContextRetrievalResult({ rawResult, result })
    return retrievalResult ? renderContextRetrievalDetail(retrievalResult) : null
  }
})

defineToolComponent({
  name: "get_trace_evidence",
  icon: MessageSquareText,
  hasDetail({ rawResult, result }) {
    return Boolean(getContextRetrievalResult({ rawResult, result }))
  },
  renderDisplay({ copy, args }) {
    const traceStepId =
      typeof args.traceStepId === "string"
        ? args.traceStepId.trim()
        : typeof args.toolCallId === "string"
          ? args.toolCallId.trim()
          : typeof args.artifactId === "string"
            ? args.artifactId.trim()
            : typeof args.runId === "string"
              ? args.runId.trim()
              : ""

    return {
      detail: traceStepId ? truncateMiddle(traceStepId, 36) : null,
      title: copy.toolCall.labels.get_trace_evidence
    }
  },
  renderDetail({ rawResult, result }) {
    const retrievalResult = getContextRetrievalResult({ rawResult, result })
    return retrievalResult ? renderContextRetrievalDetail(retrievalResult) : null
  }
})
