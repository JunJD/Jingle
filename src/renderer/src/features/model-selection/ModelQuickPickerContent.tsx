import { Search } from "lucide-react"
import { useMemo, useState } from "react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ModelConfig, Provider } from "@/types"
import { ProviderIcon } from "./provider-icon"

function isUsableQuickModel(model: ModelConfig, provider: Provider | undefined): boolean {
  return (
    model.status === "active" &&
    provider?.customConfiguration.status === "active" &&
    provider.modelListStatus === "active"
  )
}

function matchesSearch(model: ModelConfig, provider: Provider | undefined, query: string): boolean {
  if (!query) {
    return true
  }

  const haystack = [model.name, model.model, model.provider, provider?.name].join(" ").toLowerCase()
  return haystack.includes(query)
}

export function ModelQuickPickerContent(props: {
  currentModelId: string | null
  models: readonly ModelConfig[]
  onSelectModel: (modelId: string) => void
  providers: readonly Provider[]
}): React.JSX.Element {
  const { currentModelId, models, onSelectModel, providers } = props
  const { copy } = useI18n()
  const [searchQuery, setSearchQuery] = useState("")
  const selectedModel = models.find((model) => model.id === currentModelId) ?? null
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers]
  )
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const visibleModels = models
    .map((model, index) => ({ index, model }))
    .filter(({ model }) => {
      const provider = providerById.get(model.provider)
      return isUsableQuickModel(model, provider) && matchesSearch(model, provider, normalizedSearchQuery)
    })
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

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[var(--ow-space-1)]">
        {visibleModels.length > 0 ? (
          visibleModels.map((model) => {
            const provider = providerById.get(model.provider)
            const isSelected = model.id === currentModelId

            return (
              <button
                key={model.id}
                type="button"
                onClick={() => onSelectModel(model.id)}
                className={cn(
                  "flex h-[34px] w-full items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-2)] text-left transition-colors",
                  isSelected
                    ? "bg-background-secondary text-foreground"
                    : "text-muted-foreground hover:bg-background-secondary/72 hover:text-foreground"
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

      <div className="shrink-0 border-t border-border/64 p-[var(--ow-space-1)]">
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
    </>
  )
}
