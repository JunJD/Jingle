import { useEffect, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ModelSelectionContent } from "@/features/model-selection/ModelSelectionContent"
import { ProviderIcon } from "@/features/model-selection/provider-icon"
import { useI18n } from "@/lib/i18n"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"

interface ModelSwitcherProps {
  threadId: string
}

export function ModelSwitcher({ threadId }: ModelSwitcherProps): React.JSX.Element {
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const loadModelProviderState = useHistoryShellStore((state) => state.loadModelProviderState)
  const models = useHistoryShellStore((state) => state.models)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)
  const threadActions = useThreadActions(threadId)
  const selectedModel = useMemo(
    () => models.find((model) => model.id === currentModel) ?? null,
    [currentModel, models]
  )

  useEffect(() => {
    void loadModelProviderState()
  }, [loadModelProviderState])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-[var(--ow-control-h-md)] gap-[var(--ow-space-1-5)] rounded-full bg-background-secondary px-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] text-muted-foreground hover:bg-background-interactive hover:text-foreground"
        >
          {selectedModel ? (
            <>
              <ProviderIcon
                className="size-[var(--ow-icon-sm)]"
                providerId={selectedModel.provider}
              />
              <span className="font-mono">{selectedModel.model}</span>
            </>
          ) : (
            <span>{copy.modelSwitcher.selectModel}</span>
          )}
          <ChevronDown className="size-[var(--ow-icon-compact)]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="model-switcher-popover w-[var(--ow-model-popover-w)] border-border bg-popover p-0"
        align="start"
        sideOffset={8}
      >
        <ModelSelectionContent
          currentModelId={currentModel}
          onDone={() => setOpen(false)}
          onSelectModel={(modelId) => threadActions?.setCurrentModel(modelId)}
        />
      </PopoverContent>
    </Popover>
  )
}
