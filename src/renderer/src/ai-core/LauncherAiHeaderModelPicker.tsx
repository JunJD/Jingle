import { ChevronDown } from "lucide-react"
import { useEffect, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ProviderIcon } from "@/features/model-selection/provider-icon"
import { getModelQuickDisplayName } from "@/features/model-selection/model-quick-display"
import { ModelQuickPickerContent } from "@/features/model-selection/ModelQuickPickerContent"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useI18n } from "@/lib/i18n"

interface LauncherAiHeaderModelPickerProps {
  currentModelId: string | null
  fallbackLabel: string
  onSelectModel: (modelId: string) => Promise<boolean>
}

export function LauncherAiHeaderModelPicker(
  props: LauncherAiHeaderModelPickerProps
): React.JSX.Element {
  const { currentModelId, fallbackLabel, onSelectModel } = props
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)
  const loadModelProviderState = useHistoryShellStore((state) => state.loadModelProviderState)
  const models = useHistoryShellStore((state) => state.models)
  const providers = useHistoryShellStore((state) => state.providers)
  const effectiveModelId = currentModelId ?? defaultModelId
  const selectedModel = models.find((model) => model.id === effectiveModelId) ?? null
  const selectedProvider = selectedModel
    ? providers.find((provider) => provider.id === selectedModel.provider)
    : null
  const displayName = getModelQuickDisplayName(effectiveModelId, selectedModel) ?? fallbackLabel

  useEffect(() => {
    void loadModelProviderState()
    void window.api.models.getDefault("llm").then(setDefaultModelId)
  }, [loadModelProviderState])

  function handleSelectModel(modelId: string): void {
    void onSelectModel(modelId).then((didSelect) => {
      if (didSelect) {
        setOpen(false)
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={copy.launcher.changeModel}
          title={copy.launcher.changeModel}
          className="group -ml-[var(--ow-space-0-5)] mt-px flex max-w-[var(--launcher-chip-max-width)] items-center gap-[var(--ow-gap-xs)] rounded-[var(--ow-radius-xs)] px-[var(--ow-space-0-5)] py-px text-muted-foreground transition hover:bg-background-secondary/62 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {selectedProvider ? (
            <ProviderIcon
              className="size-[var(--ow-icon-xs)] shrink-0 text-muted-foreground/72 group-hover:text-foreground"
              providerId={selectedProvider.id}
            />
          ) : null}
          <span className="min-w-0 truncate [font-size:var(--ow-font-meta)] leading-[var(--ow-line-tight)]">
            {displayName}
          </span>
          <ChevronDown className="size-[var(--ow-icon-xs)] shrink-0 opacity-0 transition group-hover:opacity-70 group-data-[state=open]:opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="launcher-ai-model-popover flex flex-col overflow-hidden border-border/72 bg-popover/96 p-0"
        sideOffset={6}
      >
        <ModelQuickPickerContent
          currentModelId={effectiveModelId}
          models={models}
          onSelectModel={handleSelectModel}
          providers={providers}
        />
      </PopoverContent>
    </Popover>
  )
}
