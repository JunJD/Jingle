import { ChevronDown, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ProviderIcon } from "@/features/model-selection/provider-icon"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ModelConfig, Provider } from "@/types"

interface LauncherAiHeaderModelPickerProps {
  currentModelId: string | null
  fallbackLabel: string
  onSelectModel: (modelId: string) => void
}

function getModelName(modelId: string | null, model: ModelConfig | null): string | null {
  if (model) {
    return model.name
  }

  if (!modelId) {
    return null
  }

  const separatorIndex = modelId.indexOf(":")
  return separatorIndex >= 0 ? modelId.slice(separatorIndex + 1) : modelId
}

function matchesSearch(model: ModelConfig, provider: Provider | undefined, query: string): boolean {
  if (!query) {
    return true
  }

  const haystack = [model.name, model.model, model.provider, provider?.name].join(" ").toLowerCase()
  return haystack.includes(query)
}

export function LauncherAiHeaderModelPicker(
  props: LauncherAiHeaderModelPickerProps
): React.JSX.Element {
  const { currentModelId, fallbackLabel, onSelectModel } = props
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)
  const loadModelProviderState = useHistoryShellStore((state) => state.loadModelProviderState)
  const models = useHistoryShellStore((state) => state.models)
  const providers = useHistoryShellStore((state) => state.providers)
  const effectiveModelId = currentModelId ?? defaultModelId
  const selectedModel = models.find((model) => model.id === effectiveModelId) ?? null
  const selectedProvider = selectedModel
    ? providers.find((provider) => provider.id === selectedModel.provider)
    : null
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers]
  )
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const visibleModels = models
    .map((model, index) => ({ index, model }))
    .filter(({ model }) =>
      matchesSearch(model, providerById.get(model.provider), normalizedSearchQuery)
    )
    .sort((left, right) => {
      const selectedProviderId = selectedModel?.provider
      const leftProviderRank = left.model.provider === selectedProviderId ? 0 : 1
      const rightProviderRank = right.model.provider === selectedProviderId ? 0 : 1

      if (leftProviderRank !== rightProviderRank) {
        return leftProviderRank - rightProviderRank
      }

      return left.index - right.index
    })
    .map(({ model }) => model)
  const displayName = getModelName(effectiveModelId, selectedModel) ?? fallbackLabel

  useEffect(() => {
    void loadModelProviderState()
    void window.api.models.getDefault("llm").then(setDefaultModelId)
  }, [loadModelProviderState])

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)

    if (!nextOpen) {
      setSearchQuery("")
    }
  }

  function handleSelectModel(modelId: string): void {
    onSelectModel(modelId)
    setOpen(false)
    setSearchQuery("")
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
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
        className="launcher-ai-model-popover w-[var(--launcher-ai-model-popover-w)] overflow-hidden border-border/72 bg-popover/96 p-0"
        sideOffset={6}
      >
        <div className="max-h-[var(--launcher-ai-model-popover-list-h)] overflow-y-auto p-[var(--ow-space-1)]">
          {visibleModels.length > 0 ? (
            visibleModels.map((model) => {
              const provider = providerById.get(model.provider)
              const isSelected = model.id === effectiveModelId
              const canSelect = model.status === "active"

              return (
                <button
                  key={model.id}
                  type="button"
                  disabled={!canSelect}
                  onClick={() => handleSelectModel(model.id)}
                  className={cn(
                    "flex h-[34px] w-full items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-2)] text-left transition-colors",
                    isSelected
                      ? "bg-background-secondary text-foreground"
                      : "text-muted-foreground hover:bg-background-secondary/72 hover:text-foreground",
                    !canSelect && "cursor-default opacity-45 hover:bg-transparent"
                  )}
                >
                  <ProviderIcon
                    className="size-[var(--ow-icon-sm)] shrink-0"
                    providerId={model.provider}
                  />
                  <span className="min-w-0 flex-1 truncate [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control)]">
                    {model.name}
                  </span>
                  <span className="max-w-[96px] shrink-0 truncate text-right [font-size:var(--ow-font-meta)] leading-[var(--ow-line-tight)] text-muted-foreground">
                    {provider?.name ?? model.provider}
                  </span>
                </button>
              )
            })
          ) : (
            <div className="px-[var(--ow-space-3)] py-[var(--ow-space-6)] text-center [font-size:var(--ow-font-meta)] text-muted-foreground">
              {copy.modelSwitcher.noModelsAvailable}
            </div>
          )}
        </div>

        <div className="border-t border-border/64 p-[var(--ow-space-1)]">
          <label className="flex h-[30px] items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-2)] text-muted-foreground">
            <Search className="size-[var(--ow-icon-sm)] shrink-0" />
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent [font-size:var(--ow-font-control)] text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={copy.modelSwitcher.searchModels}
              value={searchQuery}
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
