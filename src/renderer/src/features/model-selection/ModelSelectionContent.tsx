import { useMemo, useState } from "react"
import { AlertCircle, Check, Key } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Spinner } from "@/components/ui/spinner"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ProviderId } from "@/types"
import {
  projectModelSelectionContent,
  type ModelSelectionCatalogProjection,
  type ModelSelectionLoadState
} from "./model-selection-projection"
import { ProviderIcon } from "./provider-icon"

export function ModelSelectionContent(props: {
  catalog: ModelSelectionCatalogProjection
  currentModelId: string | null
  loadState: ModelSelectionLoadState
  onDone?: () => void
  onOpenProviderSettings: (providerId: ProviderId) => void
  onRetry: () => Promise<void>
  onSelectModel: (modelId: string) => boolean | void | Promise<boolean | void>
}): React.JSX.Element {
  const {
    catalog,
    currentModelId,
    loadState,
    onDone,
    onOpenProviderSettings,
    onRetry,
    onSelectModel
  } = props
  const { copy } = useI18n()
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null)
  const projection = useMemo(
    () => projectModelSelectionContent(catalog, currentModelId, selectedProviderId),
    [catalog, currentModelId, selectedProviderId]
  )
  const selectedProvider = projection.selectedProvider

  function handleProviderClick(providerId: ProviderId): void {
    setSelectedProviderId(providerId)
  }

  function handleModelSelect(modelId: string): void {
    void Promise.resolve(onSelectModel(modelId)).then((didSelect) => {
      if (didSelect !== false) {
        onDone?.()
      }
    })
  }

  function handleOpenProviderSettings(providerId: ProviderId): void {
    onDone?.()
    onOpenProviderSettings(providerId)
  }

  return (
    <div className="model-selection-content flex min-h-[var(--jingle-model-selector-min-h)]">
      <div className="w-[var(--jingle-model-selector-sidebar-w)] border-r border-border bg-background/35 p-[var(--jingle-space-2)]">
        <div className="px-[var(--jingle-space-2)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-caption)] font-medium uppercase tracking-wider text-muted-foreground">
          {copy.modelSwitcher.provider}
        </div>
        <div className="space-y-[var(--jingle-space-0-5)]">
          {projection.providers.map((provider) => {
            return (
              <Button
                key={provider.id}
                type="button"
                onClick={() => handleProviderClick(provider.id)}
                size="sm"
                variant="ghost"
                className={cn(
                  "h-auto w-full justify-start gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-model-selector-row-radius)] px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] text-left [font-size:var(--jingle-font-meta)] font-normal",
                  provider.isSelected
                    ? "bg-background-secondary text-foreground"
                    : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                )}
              >
                <ProviderIcon
                  className="size-[var(--jingle-icon-sm)] shrink-0"
                  providerId={provider.id}
                />
                <span className="flex-1 truncate">{provider.name}</span>
                {provider.availability.kind !== "ready" ? (
                  <AlertCircle
                    className={cn(
                      "size-[var(--jingle-icon-compact)] shrink-0",
                      provider.availability.kind === "error"
                        ? "text-destructive"
                        : "text-status-warning"
                    )}
                  />
                ) : null}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-[var(--jingle-space-2)]">
        <div className="px-[var(--jingle-space-2)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-caption)] font-medium uppercase tracking-wider text-muted-foreground">
          {copy.modelSwitcher.model}
        </div>

        {loadState === "loading" ? (
          <div
            aria-live="polite"
            className="flex h-[var(--jingle-model-selector-state-h)] items-center justify-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-meta)] text-muted-foreground"
            role="status"
          >
            <Spinner />
            <span>{copy.modelSwitcher.loading}</span>
          </div>
        ) : loadState === "error" ? (
          <InlineNotice
            className="m-[var(--jingle-space-3)] flex items-center justify-between gap-[var(--jingle-space-2)]"
            tone="critical"
          >
            <span>{copy.modelSwitcher.loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void onRetry()}>
              {copy.modelSwitcher.retry}
            </Button>
          </InlineNotice>
        ) : projection.providerResolution.kind === "unavailable" ? (
          <InlineNotice className="m-[var(--jingle-space-3)]" tone="critical">
            {copy.modelSwitcher.catalogError}
          </InlineNotice>
        ) : selectedProvider?.availability.kind === "error" ? (
          <div className="flex h-[var(--jingle-model-selector-state-h)] flex-col items-center justify-center px-[var(--jingle-space-4)] text-center">
            <AlertCircle className="mb-[var(--jingle-space-2)] size-[var(--jingle-icon-lg)] text-destructive" />
            <p className="mb-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] font-medium text-foreground">
              {copy.modelSwitcher.providerError(selectedProvider.name)}
            </p>
            {selectedProvider.availability.detail ? (
              <p className="mb-[var(--jingle-space-3)] max-w-[var(--jingle-model-selector-error-max-w)] truncate [font-size:var(--jingle-font-meta)] text-muted-foreground">
                {selectedProvider.availability.detail}
              </p>
            ) : null}
            <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider.id)}>
              {copy.modelSwitcher.editApiKey}
            </Button>
          </div>
        ) : selectedProvider?.availability.kind === "discovery-required" ? (
          <InlineNotice
            className="m-[var(--jingle-space-3)] flex items-center justify-between gap-[var(--jingle-space-2)]"
            tone="neutral"
          >
            <span>{copy.modelSwitcher.modelDiscoveryPending}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleOpenProviderSettings(selectedProvider.id)}
            >
              {copy.modelSwitcher.openProviderSettings}
            </Button>
          </InlineNotice>
        ) : selectedProvider?.availability.kind === "configuration-required" ? (
          <div className="flex h-[var(--jingle-model-selector-state-h)] flex-col items-center justify-center px-[var(--jingle-space-4)] text-center">
            <Key className="mb-[var(--jingle-space-2)] size-[var(--jingle-icon-lg)] text-muted-foreground" />
            <p className="mb-[var(--jingle-space-3)] [font-size:var(--jingle-font-meta)] text-muted-foreground">
              {copy.modelSwitcher.apiKeyRequired(selectedProvider.name)}
            </p>
            <Button size="sm" onClick={() => handleOpenProviderSettings(selectedProvider.id)}>
              {copy.modelSwitcher.configureApiKey}
            </Button>
          </div>
        ) : selectedProvider ? (
          <div className="flex h-[var(--jingle-model-selector-list-h)] flex-col">
            {catalog.contractIssueCount > 0 || projection.hasSelectionIssue ? (
              <InlineNotice className="mb-[var(--jingle-space-2)]" tone="critical">
                {copy.modelSwitcher.catalogError}
              </InlineNotice>
            ) : null}
            <div className="flex-1 space-y-[var(--jingle-space-0-5)] overflow-y-auto">
              {projection.models.map((model) => (
                <Button
                  key={model.id}
                  type="button"
                  onClick={() => handleModelSelect(model.id)}
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "h-auto w-full justify-start gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-model-selector-row-radius)] px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] text-left [font-size:var(--jingle-font-meta)] font-mono font-normal",
                    model.isSelected
                      ? "bg-background-secondary text-foreground"
                      : "text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
                  )}
                >
                  <span className="flex-1 truncate">{model.modelCode}</span>
                  {model.isSelected ? (
                    <Check className="size-[var(--jingle-icon-sm)] shrink-0 text-foreground" />
                  ) : null}
                </Button>
              ))}

              {projection.models.length === 0 ? (
                <p className="px-[var(--jingle-space-2)] py-[var(--jingle-space-4)] [font-size:var(--jingle-font-meta)] text-muted-foreground">
                  {copy.modelSwitcher.noModelsAvailable}
                </p>
              ) : null}
            </div>

            {selectedProvider.availability.kind === "ready" ? (
              <Button
                type="button"
                onClick={() => handleOpenProviderSettings(selectedProvider.id)}
                size="sm"
                variant="ghost"
                className="mt-[var(--jingle-space-2)] h-auto w-full justify-start rounded-[var(--jingle-model-selector-row-radius)] border-t border-border px-[var(--jingle-space-2)] pt-[var(--jingle-space-2)] text-left [font-size:var(--jingle-font-meta)] font-normal text-muted-foreground hover:bg-background-secondary/70 hover:text-foreground"
              >
                {copy.modelSwitcher.editApiKey}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex h-[var(--jingle-model-selector-state-h)] items-center justify-center px-[var(--jingle-space-4)] text-center [font-size:var(--jingle-font-meta)] text-muted-foreground">
            {copy.modelSwitcher.noModelsAvailable}
          </div>
        )}
      </div>
    </div>
  )
}
