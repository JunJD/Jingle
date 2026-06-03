import { useEffect, useState } from "react"
import type { OpenworkMemoryInclusionRecord } from "@shared/openwork-memory"
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
  const [includedMemories, setIncludedMemories] = useState<OpenworkMemoryInclusionRecord[]>([])

  useEffect(() => {
    if (!runId) {
      setIncludedMemories([])
      return
    }

    void window.api.memory.getSettings().then((settings) => {
      if (!settings.showIncludedMemories) {
        setIncludedMemories([])
        return
      }

      void window.api.memory.listIncludedMemoriesForRun(runId).then(setIncludedMemories)
    })
  }, [runId])

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
