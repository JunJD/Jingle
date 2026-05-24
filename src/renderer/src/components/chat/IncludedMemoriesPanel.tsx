import { useEffect, useState } from "react"
import { Brain } from "lucide-react"
import type { OpenworkMemoryInclusionRecord } from "@shared/openwork-memory"
import { useI18n } from "@/lib/i18n"

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
    <div className="border-t border-border pt-[var(--ow-space-4)]">
      <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-label)] font-semibold text-muted-foreground">
        <Brain className="size-[var(--ow-icon-sm)]" />
        {copy.chat.includedMemoriesTitle(includedMemories.length)}
      </div>
      <div className="mt-[var(--ow-space-2)] grid gap-[var(--ow-space-1)]">
        {includedMemories.map((memory) => (
          <div
            key={memory.inclusionId}
            className="rounded-[var(--ow-radius-sm)] border border-border/70 bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground"
          >
            {memory.content}
          </div>
        ))}
      </div>
    </div>
  )
}
