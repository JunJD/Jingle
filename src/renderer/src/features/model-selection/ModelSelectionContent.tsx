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
  onSelectModel: (modelId: string) => void
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
    onSelectModel(modelId)
    onDone?.()
  }

  function handleOpenProviderSettings(provider: Provider): void {
    onDone?.()
    void window.electron.openSettingsTab("provider", { providerId: provider.id })
  }

  return (
    <div className="flex min-h-[240px]">
      <div className="w-[140px] border-r border-border bg-background/35 p-2">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {copy.modelSwitcher.provider}
        </div>
        <div className="space-y-0.5">
          {providers.map((provider) => {
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => handleProviderClick(provider)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[10px] px-2 py-1 text-left text-xs transition-colors",
                  effectiveProviderId === provider.id
                    ? "bg-background-secondary text-foreground"
                    : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                )}
              >
                <ProviderIcon className="size-3.5 shrink-0" providerId={provider.id} />
                <span className="flex-1 truncate">{provider.name}</span>
                {provider.modelListStatus !== "active" ? (
                  <AlertCircle
                    className={cn(
                      "size-3 shrink-0",
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

      <div className="flex flex-1 flex-col p-2">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {copy.modelSwitcher.model}
        </div>

        {selectedProvider?.modelListStatus === "error" ? (
          <div className="flex h-[180px] flex-col items-center justify-center px-4 text-center">
            <AlertCircle className="mb-2 size-6 text-destructive" />
            <p className="mb-1 text-xs font-medium text-foreground">
              {copy.modelSwitcher.providerError(selectedProvider.name)}
            </p>
            <p className="mb-3 max-w-[220px] truncate text-xs text-muted-foreground">
              {selectedProvider.modelListError}
            </p>
            <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider)}>
              {copy.modelSwitcher.editApiKey}
            </Button>
          </div>
        ) : selectedProvider && !selectedProviderConfigured ? (
          <div className="flex h-[180px] flex-col items-center justify-center px-4 text-center">
            <Key className="mb-2 size-6 text-muted-foreground" />
            <p className="mb-3 text-xs text-muted-foreground">
              {copy.modelSwitcher.apiKeyRequired(selectedProvider.name)}
            </p>
            <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider)}>
              {copy.modelSwitcher.configureApiKey}
            </Button>
          </div>
        ) : (
          <div className="flex h-[200px] flex-col">
            <div className="flex-1 space-y-0.5 overflow-y-auto">
              {filteredModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleModelSelect(model.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[10px] px-2 py-1 text-left text-xs font-mono transition-colors",
                    currentModelId === model.id
                      ? "bg-background-secondary text-foreground"
                      : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                  )}
                >
                  <span className="flex-1 truncate">{model.model}</span>
                  {currentModelId === model.id ? (
                    <Check className="size-3.5 shrink-0 text-foreground" />
                  ) : null}
                </button>
              ))}

              {filteredModels.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  {copy.modelSwitcher.noModelsAvailable}
                </p>
              ) : null}
            </div>

            {selectedProviderConfigured && selectedProvider ? (
              <button
                type="button"
                onClick={() => handleOpenProviderSettings(selectedProvider)}
                className="mt-2 w-full rounded-[10px] border-t border-border px-2 pt-2 text-left text-xs text-muted-foreground transition-colors hover:bg-background-secondary/70 hover:text-foreground"
              >
                {copy.modelSwitcher.editApiKey}
              </button>
            ) : null}
          </div>
        )}

        {!selectedModel && providers.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {copy.modelSwitcher.noModelsAvailable}
          </div>
        ) : null}
      </div>
    </div>
  )
}
