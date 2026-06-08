import { useEffect, useState } from "react"
import { AlertCircle, Check, Key } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { cn } from "@/lib/utils"
import type { Provider, ProviderId } from "@/types"
import { ProviderIcon } from "./provider-icon"

export function ModelSelectionContent(props: {
  currentModelId: string | null
  onDone?: () => void
  onSelectModel: (modelId: string) => boolean | void | Promise<boolean | void>
}): React.JSX.Element {
  const { currentModelId, onDone, onSelectModel } = props
  const { copy } = useI18n()
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null)
  const models = useHistoryShellStore((state) => state.models)
  const providers = useHistoryShellStore((state) => state.providers)
  const loadModelProviderState = useHistoryShellStore((state) => state.loadModelProviderState)

  useEffect(() => {
    void loadModelProviderState()
  }, [loadModelProviderState])

  const effectiveProviderId =
    selectedProviderId ||
    (currentModelId ? models.find((model) => model.id === currentModelId)?.provider : null) ||
    providers[0]?.id ||
    null
  const filteredModels = effectiveProviderId
    ? models.filter((model) => model.provider === effectiveProviderId)
    : []
  const selectedProvider = providers.find((provider) => provider.id === effectiveProviderId)
  const selectedModel = models.find((model) => model.id === currentModelId)
  const selectedProviderConfigured = selectedProvider?.customConfiguration.status === "active"

  function handleProviderClick(provider: Provider): void {
    setSelectedProviderId(provider.id)
  }

  function handleModelSelect(modelId: string): void {
    void Promise.resolve(onSelectModel(modelId)).then((didSelect) => {
      if (didSelect !== false) {
        onDone?.()
      }
    })
  }

  function handleOpenProviderSettings(provider: Provider): void {
    onDone?.()
    void window.electron.openSettingsTab("provider", { providerId: provider.id })
  }

  return (
    <div className="model-selection-content flex min-h-[var(--ow-model-selector-min-h)]">
      <div className="w-[var(--ow-model-selector-sidebar-w)] border-r border-border bg-background/35 p-[var(--ow-space-2)]">
        <div className="px-[var(--ow-space-2)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-caption)] font-medium uppercase tracking-wider text-muted-foreground">
          {copy.modelSwitcher.provider}
        </div>
        <div className="space-y-[var(--ow-space-0-5)]">
          {providers.map((provider) => {
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => handleProviderClick(provider)}
                className={cn(
                  "flex w-full items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-model-selector-row-radius)] px-[var(--ow-space-2)] py-[var(--ow-space-1)] text-left [font-size:var(--ow-font-meta)] transition-colors",
                  effectiveProviderId === provider.id
                    ? "bg-background-secondary text-foreground"
                    : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                )}
              >
                <ProviderIcon
                  className="size-[var(--ow-icon-sm)] shrink-0"
                  providerId={provider.id}
                />
                <span className="flex-1 truncate">{provider.name}</span>
                {provider.modelListStatus !== "active" ? (
                  <AlertCircle
                    className={cn(
                      "size-[var(--ow-icon-compact)] shrink-0",
                      provider.modelListStatus === "error"
                        ? "text-destructive"
                        : "text-status-warning"
                    )}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-[var(--ow-space-2)]">
        <div className="px-[var(--ow-space-2)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-caption)] font-medium uppercase tracking-wider text-muted-foreground">
          {copy.modelSwitcher.model}
        </div>

        {selectedProvider?.modelListStatus === "error" ? (
          <div className="flex h-[var(--ow-model-selector-state-h)] flex-col items-center justify-center px-[var(--ow-space-4)] text-center">
            <AlertCircle className="mb-[var(--ow-space-2)] size-[var(--ow-icon-lg)] text-destructive" />
            <p className="mb-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] font-medium text-foreground">
              {copy.modelSwitcher.providerError(selectedProvider.name)}
            </p>
            <p className="mb-[var(--ow-space-3)] max-w-[var(--ow-model-selector-error-max-w)] truncate [font-size:var(--ow-font-meta)] text-muted-foreground">
              {selectedProvider.modelListError}
            </p>
            <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider)}>
              {copy.modelSwitcher.editApiKey}
            </Button>
          </div>
        ) : selectedProvider && !selectedProviderConfigured ? (
          <div className="flex h-[var(--ow-model-selector-state-h)] flex-col items-center justify-center px-[var(--ow-space-4)] text-center">
            <Key className="mb-[var(--ow-space-2)] size-[var(--ow-icon-lg)] text-muted-foreground" />
            <p className="mb-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] text-muted-foreground">
              {copy.modelSwitcher.apiKeyRequired(selectedProvider.name)}
            </p>
            <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider)}>
              {copy.modelSwitcher.configureApiKey}
            </Button>
          </div>
        ) : (
          <div className="flex h-[var(--ow-model-selector-list-h)] flex-col">
            <div className="flex-1 space-y-[var(--ow-space-0-5)] overflow-y-auto">
              {filteredModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleModelSelect(model.id)}
                  className={cn(
                    "flex w-full items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-model-selector-row-radius)] px-[var(--ow-space-2)] py-[var(--ow-space-1)] text-left [font-size:var(--ow-font-meta)] font-mono transition-colors",
                    currentModelId === model.id
                      ? "bg-background-secondary text-foreground"
                      : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                  )}
                >
                  <span className="flex-1 truncate">{model.model}</span>
                  {currentModelId === model.id ? (
                    <Check className="size-[var(--ow-icon-sm)] shrink-0 text-foreground" />
                  ) : null}
                </button>
              ))}

              {filteredModels.length === 0 ? (
                <p className="px-[var(--ow-space-2)] py-[var(--ow-space-4)] [font-size:var(--ow-font-meta)] text-muted-foreground">
                  {copy.modelSwitcher.noModelsAvailable}
                </p>
              ) : null}
            </div>

            {selectedProviderConfigured && selectedProvider ? (
              <button
                type="button"
                onClick={() => handleOpenProviderSettings(selectedProvider)}
                className="mt-[var(--ow-space-2)] w-full rounded-[var(--ow-model-selector-row-radius)] border-t border-border px-[var(--ow-space-2)] pt-[var(--ow-space-2)] text-left [font-size:var(--ow-font-meta)] text-muted-foreground transition-colors hover:bg-background-secondary/70 hover:text-foreground"
              >
                {copy.modelSwitcher.editApiKey}
              </button>
            ) : null}
          </div>
        )}

        {!selectedModel && providers.length === 0 ? (
          <div className="flex h-[var(--ow-model-selector-state-h)] items-center justify-center px-[var(--ow-space-4)] text-center [font-size:var(--ow-font-meta)] text-muted-foreground">
            {copy.modelSwitcher.noModelsAvailable}
          </div>
        ) : null}
      </div>
    </div>
  )
}
