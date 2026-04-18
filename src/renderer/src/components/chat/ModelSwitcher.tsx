import { useEffect, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ModelSelectionContent, getModelProviderIcon } from "@/features/model-selection/ModelSelectionContent"
import { useI18n } from "@/lib/i18n"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useCurrentThread } from "@/lib/thread-context"

interface ModelSwitcherProps {
  threadId: string
}

export function ModelSwitcher({ threadId }: ModelSwitcherProps): React.JSX.Element {
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const { loadModelProviderState, models } = useHistoryShellStore()
  const { currentModel, setCurrentModel } = useCurrentThread(threadId)
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
          className="h-8 gap-1.5 rounded-full bg-background-secondary px-3 text-xs text-muted-foreground hover:bg-background-interactive hover:text-foreground"
        >
          {selectedModel ? (
            <>
              {getModelProviderIcon(selectedModel.provider)({ className: "size-3.5" })}
              <span className="font-mono">{selectedModel.model}</span>
            </>
          ) : (
            <span>{copy.modelSwitcher.selectModel}</span>
          )}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] border-border bg-popover p-0" align="start" sideOffset={8}>
        <ModelSelectionContent
          currentModelId={currentModel}
          onDone={() => setOpen(false)}
          onSelectModel={setCurrentModel}
        />
      </PopoverContent>
    </Popover>
  )
}
