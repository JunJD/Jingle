import { useMemo } from "react"
import type { AgentContextInclusion } from "@shared/openwork-memory"
import { useI18n } from "@/lib/i18n"
import { useThreadSelector } from "@/lib/thread-context"
import { InlineActivityReferences } from "./InlineActivityReferences"

interface ContextEvidencePanelProps {
  threadId: string
}

const EMPTY_INCLUSIONS: readonly AgentContextInclusion[] = []

export function ContextEvidencePanel(props: ContextEvidencePanelProps): React.JSX.Element | null {
  const { threadId } = props
  const { copy } = useI18n()
  const contextInclusions = useThreadSelector(
    threadId,
    (state) => state?.agent.contextInclusions ?? EMPTY_INCLUSIONS
  )

  const visibleInclusions = useMemo(
    () => contextInclusions.filter((i) => i.mode === "provided" || i.mode === "retrieved"),
    [contextInclusions]
  )

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
      inclusion.sourceType,
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
