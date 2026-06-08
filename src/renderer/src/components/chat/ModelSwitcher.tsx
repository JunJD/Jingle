import { useEffect, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ModelQuickPickerContent } from "@/features/model-selection/ModelQuickPickerContent"
import { ProviderIcon } from "@/features/model-selection/provider-icon"
import { useI18n } from "@/lib/i18n"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { updateAgentThreadModel } from "@/lib/agent-control"
import { useThreadContext, useThreadSelector } from "@/lib/thread-context"

interface ModelSwitcherProps {
  threadId: string
}

export function ModelSwitcher({ threadId }: ModelSwitcherProps): React.JSX.Element {
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadModelProviderState = useHistoryShellStore((state) => state.loadModelProviderState)
  const models = useHistoryShellStore((state) => state.models)
  const providers = useHistoryShellStore((state) => state.providers)
  const updateThread = useHistoryShellStore((state) => state.updateThread)
  const currentModel = useThreadSelector(threadId, (state) => state?.agent.currentModel ?? null)
  const threadContext = useThreadContext()
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
        className="model-switcher-popover flex flex-col overflow-hidden border-border/72 bg-popover/96 p-0"
        align="start"
        sideOffset={8}
      >
        {error ? (
          <div className="border-b border-border/72 px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-destructive">
            {error}
          </div>
        ) : null}
        <ModelQuickPickerContent
          currentModelId={currentModel}
          models={models}
          onSelectModel={(modelId) => {
            setError(null)
            void updateAgentThreadModel({
              modelId,
              threadContext,
              threadId,
              updateThread
            })
              .then(() => {
                setOpen(false)
              })
              .catch((caughtError: unknown) => {
                setError(caughtError instanceof Error ? caughtError.message : String(caughtError))
              })
          }}
          providers={providers}
        />
      </PopoverContent>
    </Popover>
  )
}
