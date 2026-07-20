import type { Message as ThreadMessage } from "@/types"
import { useEffect, useState } from "react"
import { extractMessageText } from "@shared/message-content"
import {
  assistantContentProjectionFingerprint,
  projectAssistantDiffLines,
  type AssistantContentPart,
  type AssistantContentPartsResult
} from "@shared/assistant-content-part"
import type { ContentCardIdentity } from "@shared/content-card"
import type { ContentSelectionDraft } from "@shared/content-selection"
import { MessageResponse } from "./message"
import { ContentCardFrame } from "./ContentCardFrame"
import { projectAssistantContentPartCard } from "@/lib/content-card-registry"
import {
  projectionForAssistantContentSource,
  type LoadedAssistantContentProjection
} from "@/lib/assistant-content-projection-cache"
import {
  createCanonicalHydrationOwner,
  reportCanonicalContentFailure
} from "@/lib/canonical-content-hydration"
import { useI18n } from "@/lib/i18n"
import type { AppCopy } from "@/lib/i18n/messages"
import { useContentWindowHydration } from "./ContentWindowHydrationContext"

type DurableContentSyncIssue = Extract<
  AssistantContentPartsResult,
  { status: "blocked" | "exhausted" | "failed" | "parked" }
>["issue"]
type ContentSyncIssue = DurableContentSyncIssue | { code: "transport-failure" }

function syncIssueMessage(issue: ContentSyncIssue, copy: AppCopy["chat"]): string {
  if (issue.code === "transport-failure") return copy.contentCardSyncTransportFailure
  if (issue.code === "retryable-failure") return copy.contentCardSyncRetryableFailure
  if (issue.code === "retry-exhausted") return copy.contentCardSyncRetryExhausted
  if (issue.code === "terminal-failure") return copy.contentCardSyncTerminalFailure
  return issue.reason === "invalid-json"
    ? copy.contentCardSourceInvalidJson
    : copy.contentCardSourceNoncanonical
}

function ContentSyncIssueNotice(props: { issue: ContentSyncIssue }): React.JSX.Element {
  const { copy } = useI18n()
  return (
    <p className="mt-2 text-[var(--jingle-font-meta)] text-destructive" role="alert">
      {syncIssueMessage(props.issue, copy.chat)}
    </p>
  )
}

function identityFor(
  message: ThreadMessage,
  part: AssistantContentPart,
  threadId: string
): ContentCardIdentity {
  return projectAssistantContentPartCard({
    kind: part.kind,
    messageId: message.id,
    partId: part.id,
    payload: part.payload,
    revision: part.revision,
    threadId
  }).identity
}

function selectionFor(
  identity: ContentCardIdentity,
  text: string,
  pending: boolean
): ContentSelectionDraft {
  return {
    anchor: { kind: "whole-card" },
    anchorResolution: pending ? "pending-stream" : "resolved",
    card: identity,
    contextHash: `revision:${identity.revision}`,
    quote: text.trim() || identity.kind
  }
}

function CodeSurface(props: { code: string; language: string | null }): React.JSX.Element {
  return (
    <pre className="max-h-[440px] overflow-auto rounded-[var(--jingle-radius-md)] bg-background-secondary p-3 text-[var(--jingle-font-code)] leading-[var(--jingle-line-code)]">
      <code data-code-language={props.language ?? "text"}>{props.code}</code>
    </pre>
  )
}

function DiffSurface(props: { patch: string }): React.JSX.Element {
  return (
    <div className="max-h-[440px] overflow-auto rounded-[var(--jingle-radius-md)] bg-background-secondary font-mono text-[var(--jingle-font-code)] leading-[var(--jingle-line-code)]">
      {projectAssistantDiffLines(props.patch).map(({ lineNumber, side, text }, index) => {
        return (
          <div
            className={
              text.startsWith("+")
                ? "bg-status-nominal/10"
                : text.startsWith("-")
                  ? "bg-destructive/10"
                  : undefined
            }
            data-diff-line={lineNumber}
            data-diff-side={side}
            data-diff-text={text}
            key={`${index}:${text}`}
          >
            <span className="inline-block w-10 select-none pr-2 text-right text-muted-foreground">
              {lineNumber}
            </span>
            <span>{text || " "}</span>
          </div>
        )
      })}
    </div>
  )
}

function TableSurface(props: {
  payload: Extract<AssistantContentPart, { kind: "table" }>["payload"]
}): React.JSX.Element {
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-left text-[var(--jingle-font-body)]">
        <thead>
          <tr data-table-row-id="header">
            {props.payload.columns.map((column) => (
              <th
                className="border border-border bg-background-secondary px-3 py-2"
                data-table-column-id={column.id}
                key={column.id}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.payload.rows.map((row) => (
            <tr data-table-row-id={row.id} key={row.id}>
              {props.payload.columns.map((column) => (
                <td
                  className="border border-border px-3 py-2"
                  data-table-column-id={column.id}
                  key={column.id}
                >
                  {row.cells[column.id] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function partText(part: AssistantContentPart): string {
  switch (part.kind) {
    case "narrative":
      return part.payload.markdown
    case "code":
      return part.payload.code
    case "diff":
      return part.payload.patch
    case "mermaid":
      return part.payload.source
    case "table":
      return [
        part.payload.columns.map((column) => column.label).join(" | "),
        ...part.payload.rows.map((row) =>
          part.payload.columns.map((column) => row.cells[column.id] ?? "").join(" | ")
        )
      ].join("\n")
  }
}

function titleFor(kind: AssistantContentPart["kind"]): string {
  return { narrative: "回答", code: "代码", diff: "变更", table: "表格", mermaid: "图表" }[kind]
}

export function AssistantContentCards(props: {
  isStreaming: boolean
  message: ThreadMessage
  threadId: string
}): React.JSX.Element | null {
  const { isStreaming, message, threadId } = props
  const windowHydration = useContentWindowHydration()
  const text = extractMessageText(message.content)
  const [loadedProjection, setLoadedProjection] = useState<LoadedAssistantContentProjection | null>(
    null
  )
  const [syncIssue, setSyncIssue] = useState<{
    issue: ContentSyncIssue
    messageId: string
    threadId: string
  } | null>(null)
  const currentSyncIssue =
    syncIssue?.messageId === message.id && syncIssue.threadId === threadId ? syncIssue.issue : null
  const projection = projectionForAssistantContentSource({
    isStreaming,
    loaded: loadedProjection,
    messageId: message.id,
    sourceText: text,
    threadId
  })

  useEffect(() => {
    if (isStreaming || !text.trim()) return undefined
    let cardRegistration: ReturnType<typeof windowHydration.registerCard> | null = null
    const attemptController = new AbortController()
    const hydration = createCanonicalHydrationOwner({
      load: () =>
        windowHydration.runAttempt(
          () =>
            window.api.contentCards.getAssistantParts({
              messageId: message.id,
              threadId
            }),
          attemptController.signal
        ),
      onFailure: ({ attempt }) => {
        setSyncIssue({ issue: { code: "transport-failure" }, messageId: message.id, threadId })
        if (attempt === 1) {
          reportCanonicalContentFailure({
            operation: "hydrate-content-card",
            summary: "Assistant content card hydration failed"
          })
        }
      },
      onSuccess: (result) => {
        if (
          result.status === "blocked" ||
          result.status === "exhausted" ||
          result.status === "failed" ||
          result.status === "parked"
        ) {
          setLoadedProjection(null)
          cardRegistration?.updateProjectionFingerprint(null)
          setSyncIssue({ issue: result.issue, messageId: message.id, threadId })
          return
        }
        setSyncIssue((current) =>
          current?.messageId === message.id && current.threadId === threadId ? null : current
        )
        if (result.status === "pending-stream") return
        setLoadedProjection({
          messageId: message.id,
          projection: result.projection,
          sourceText: text,
          threadId
        })
        cardRegistration?.updateProjectionFingerprint(
          assistantContentProjectionFingerprint(result.projection)
        )
      }
    })
    const requestHydration = (): Promise<void> => hydration.request({ resetFailures: true })
    cardRegistration = windowHydration.registerCard({
      messageId: message.id,
      refresh: requestHydration
    })
    void requestHydration()
    return () => {
      attemptController.abort()
      cardRegistration?.dispose()
      hydration.dispose()
    }
  }, [isStreaming, message.id, text, threadId, windowHydration])

  if (!projection) {
    return text.trim() ? (
      <>
        <MessageResponse isAnimating={isStreaming}>{text}</MessageResponse>
        {currentSyncIssue && !isStreaming ? (
          <ContentSyncIssueNotice issue={currentSyncIssue} />
        ) : null}
      </>
    ) : null
  }

  if (projection.parts.length === 0) {
    return currentSyncIssue ? <ContentSyncIssueNotice issue={currentSyncIssue} /> : null
  }
  return (
    <>
      <div className="space-y-[var(--jingle-space-3)]">
        {projection.parts.map((part) => {
          const textValue = partText(part)
          const identity = identityFor(message, part, threadId)
          const selection = selectionFor(identity, textValue, false)
          let content: React.ReactNode
          if (part.kind === "code") {
            content = <CodeSurface code={part.payload.code} language={part.payload.language} />
          } else if (part.kind === "diff") {
            content = <DiffSurface patch={part.payload.patch} />
          } else if (part.kind === "table") {
            content = <TableSurface payload={part.payload} />
          } else if (part.kind === "mermaid") {
            content = (
              <MessageResponse
                isAnimating={false}
              >{`\`\`\`mermaid\n${part.payload.source}\n\`\`\``}</MessageResponse>
            )
          } else {
            content = <MessageResponse isAnimating={false}>{part.payload.markdown}</MessageResponse>
          }
          return (
            <ContentCardFrame
              identity={identity}
              key={identity.cardId}
              selection={selection}
              title={titleFor(part.kind)}
            >
              <div
                data-assistant-message-id={message.id}
                data-assistant-message-streaming={isStreaming ? "true" : "false"}
                data-assistant-selection-source={part.kind === "mermaid" ? undefined : "true"}
              >
                {content}
              </div>
            </ContentCardFrame>
          )
        })}
      </div>
      {currentSyncIssue ? <ContentSyncIssueNotice issue={currentSyncIssue} /> : null}
    </>
  )
}
