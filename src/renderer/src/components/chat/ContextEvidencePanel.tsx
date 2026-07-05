import { useMemo } from "react"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import { useI18n } from "@/lib/i18n"
import { useThreadSelector } from "@/lib/thread-context"
import { InlineActivityReferences } from "./InlineActivityReferences"

interface ContextEvidencePanelProps {
  messageId?: string | null
  threadId: string
  turnId?: string | null
}

const EMPTY_INCLUSIONS: readonly AgentContextInclusion[] = []

function sourceLabel(sourceType: AgentContextInclusion["sourceType"]): string {
  switch (sourceType) {
    case "memory":
      return "memory"
    case "context_file":
      return "context file"
    case "thread_digest":
      return "thread summary"
    case "history_message":
      return "history message"
    case "trace_step":
      return "trace step"
    case "artifact":
      return "artifact"
  }
}

export function ContextEvidencePanel(props: ContextEvidencePanelProps): React.JSX.Element | null {
  const { messageId = null, threadId, turnId = null } = props
  const { copy } = useI18n()
  const contextInclusions = useThreadSelector(
    threadId,
    (state) => state?.agent.contextInclusions ?? EMPTY_INCLUSIONS
  )

  const visibleInclusions = useMemo(() => {
    const matchesPlacement = (inclusion: AgentContextInclusion): boolean => {
      if (turnId) {
        return inclusion.turnId === turnId
      }

      if (messageId) {
        return inclusion.messageId === messageId
      }

      return inclusion.turnId === null && inclusion.messageId === null
    }

    return contextInclusions.filter(
      (i) => (i.mode === "provided" || i.mode === "retrieved") && matchesPlacement(i)
    )
  }, [contextInclusions, messageId, turnId])

  if (visibleInclusions.length === 0) {
    return null
  }

  const modeLabel = (mode: AgentContextInclusion["mode"]): string => {
    switch (mode) {
      case "provided":
        return copy.chat.contextEvidenceProvided
      case "retrieved":
        return copy.chat.contextEvidenceRetrieved
      case "cited":
        return copy.chat.contextEvidenceCited
    }
  }

  const metaLabel = (inclusion: AgentContextInclusion): string =>
    [
      modeLabel(inclusion.mode),
      sourceLabel(inclusion.sourceType),
      inclusion.availability === "unavailable" ? inclusion.unavailableReason?.message : null
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" · ")

  return (
    <InlineActivityReferences
      defaultOpen={false}
      items={visibleInclusions.map((inclusion) => ({
        detail: inclusion.preview,
        key: inclusion.id,
        meta: metaLabel(inclusion),
        title: inclusion.title
      }))}
      title={copy.chat.contextEvidenceTitle(visibleInclusions.length)}
    />
  )
}
