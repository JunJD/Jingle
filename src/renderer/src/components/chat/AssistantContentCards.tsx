import type { Message as ThreadMessage } from "@/types"
import { extractMessageText } from "@shared/message-content"
import type {
  AssistantContentPart,
  AssistantContentPartsProjection
} from "@shared/assistant-content-part"
import type { ContentCardIdentity } from "@shared/content-card"
import type { ContentSelectionDraft } from "@shared/content-selection"
import { MessageResponse } from "./message"
import { ContentCardFrame } from "./ContentCardFrame"
import { projectAssistantContentPartCard } from "@/lib/content-card-registry"

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

function projectDiffLines(patch: string): Array<{
  line: string
  lineNumber: number
  side: "after" | "before"
}> {
  let beforeLine = 0
  let afterLine = 0
  const result: Array<{ line: string; lineNumber: number; side: "after" | "before" }> = []
  for (const line of patch.split("\n")) {
    const side = line.startsWith("-") && !line.startsWith("---") ? "before" : "after"
    if (side === "before") beforeLine += 1
    else if (!line.startsWith("+")) {
      beforeLine += 1
      afterLine += 1
    } else afterLine += 1
    result.push({ line, lineNumber: side === "before" ? beforeLine : afterLine, side })
  }
  return result
}

function DiffSurface(props: { patch: string }): React.JSX.Element {
  return (
    <div className="max-h-[440px] overflow-auto rounded-[var(--jingle-radius-md)] bg-background-secondary font-mono text-[var(--jingle-font-code)] leading-[var(--jingle-line-code)]">
      {projectDiffLines(props.patch).map(({ line, lineNumber, side }, index) => {
        return (
          <div
            className={
              line.startsWith("+")
                ? "bg-status-nominal/10"
                : line.startsWith("-")
                  ? "bg-destructive/10"
                  : undefined
            }
            data-diff-line={lineNumber}
            data-diff-side={side}
            key={`${index}:${line}`}
          >
            <span className="inline-block w-10 select-none pr-2 text-right text-muted-foreground">
              {lineNumber}
            </span>
            <span>{line || " "}</span>
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
  const text = extractMessageText(message.content)
  const [loadedProjection, setLoadedProjection] = useState<AssistantContentPartsProjection | null>(
    null
  )
  const projection = loadedProjection

  useEffect(() => {
    if (projection || isStreaming || !text.trim()) return undefined
    let active = true
    let timeoutId: number | null = null
    let attempt = 0
    const load = async (): Promise<void> => {
      const result = await window.api.contentCards.getAssistantParts({
        messageId: message.id,
        threadId
      })
      if (!active) return
      if (result.status === "ready") {
        setLoadedProjection(result.projection)
        return
      }
      attempt += 1
      if (attempt < 20) timeoutId = window.setTimeout(() => void load(), 100)
    }
    void load()
    return () => {
      active = false
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [isStreaming, message.id, projection, text, threadId])

  if (!projection) {
    return text.trim() ? <MessageResponse isAnimating={isStreaming}>{text}</MessageResponse> : null
  }

  if (projection.parts.length === 0) return null
  return (
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
            <MessageResponse isAnimating={false}>{`\`\`\`mermaid\n${part.payload.source}\n\`\`\``}</MessageResponse>
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
  )
}
import { useEffect, useState } from "react"
