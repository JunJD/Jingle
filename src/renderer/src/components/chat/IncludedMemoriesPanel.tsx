import { useEffect, useState } from "react"
import type { JingleMemoryInclusionRecord } from "@shared/jingle-memory"
import { useI18n } from "@/lib/i18n"
import { InlineActivityReferences } from "./InlineActivityReferences"

interface IncludedMemoriesPanelProps {
  runId: string | null
}

export function IncludedMemoriesPanel(
  props: IncludedMemoriesPanelProps
): React.JSX.Element | null {
  const { runId } = props
  const { copy } = useI18n()
  const [includedMemoriesState, setIncludedMemoriesState] = useState<{
    records: JingleMemoryInclusionRecord[]
    runId: string
  } | null>(null)

  useEffect(() => {
    if (!runId) {
      return
    }

    let cancelled = false

    void window.api.memory.getSettings().then((settings) => {
      if (cancelled) {
        return
      }

      if (!settings.showIncludedMemories) {
        setIncludedMemoriesState({ records: [], runId })
        return
      }

      void window.api.memory.listIncludedMemoriesForRun(runId).then((records) => {
        if (cancelled) {
          return
        }

        setIncludedMemoriesState({ records, runId })
      })
    })

    return () => {
      cancelled = true
    }
  }, [runId])

  const includedMemories =
    runId && includedMemoriesState?.runId === runId ? includedMemoriesState.records : []

  if (includedMemories.length === 0) {
    return null
  }

  return (
    <InlineActivityReferences
      items={includedMemories.map((memory) => ({
        key: memory.inclusionId,
        meta: [memory.type, memory.scope].join(" · "),
        title: memory.content
      }))}
      title={copy.chat.includedMemoriesTitle(includedMemories.length)}
    />
  )
}
