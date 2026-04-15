import { AlertTriangle, ChevronRight, Info, Loader2 } from "lucide-react"
import { memo, useState } from "react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { getSettingsCopy } from "@/settings/copy"
import type { ModelConfig, ProviderId } from "@/types"
import type { ModelProvider } from "../declarations"
import ModelBadge from "../model-badge"
import ProviderIcon from "../provider-icon"
import CredentialPanel from "./credential-panel"
import ModelList from "./model-list"

type ProviderAddedCardProps = {
  defaultModelId: string
  notConfigured?: boolean
  onLoadProviderModels: (providerId: ProviderId) => Promise<ModelConfig[]>
  onOpenProviderDialog: (providerId: ProviderId) => void
  provider: ModelProvider
}

function ProviderAddedCard(props: ProviderAddedCardProps): React.JSX.Element {
  const { defaultModelId, notConfigured, onLoadProviderModels, onOpenProviderDialog, provider } =
    props
  const [expanded, setExpanded] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [loadedModels, setLoadedModels] = useState<ModelConfig[] | null>(null)
  const [modelLoadError, setModelLoadError] = useState<string | null>(null)
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const hasProviderError = provider.modelListStatus === "error"
  const visibleModels = loadedModels ?? provider.models
  const shouldLoadRemoteModels = !notConfigured && loadedModels === null

  const handleOpenModelList = async (): Promise<void> => {
    if (loadingModels) {
      return
    }

    if (!hasProviderError && visibleModels.length > 0 && !shouldLoadRemoteModels) {
      setModelLoadError(null)
      setExpanded(true)
      return
    }

    setLoadingModels(true)
    setModelLoadError(null)

    try {
      const nextModels = await onLoadProviderModels(provider.provider)
      setLoadedModels(nextModels)
      setExpanded(true)
    } catch (error) {
      setModelLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingModels(false)
    }
  }

  const handleToggleModelList = (): void => {
    if (expanded) {
      setExpanded(false)
      return
    }

    void handleOpenModelList()
  }

  const handleOpenCredentialDialog = (providerId: ProviderId): void => {
    setLoadedModels(null)
    onOpenProviderDialog(providerId)
  }

  return (
    <div
      className={cn(
        "border-t border-border first:border-t-0",
        hasProviderError && "bg-destructive/5"
      )}
    >
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(210px,1.1fr)_112px_132px_minmax(230px,1fr)] md:items-center">
        <div className="min-w-0">
          <ProviderIcon provider={provider} />
          <div className="mt-2 flex flex-wrap gap-1 md:hidden">
            <ModelBadge>{copy.provider.llmBadge}</ModelBadge>
            {hasProviderError ? (
              <ModelBadge className="border-destructive/25 bg-destructive/10 text-destructive">
                {copy.provider.modelListErrorBadge}
              </ModelBadge>
            ) : notConfigured ? (
              <ModelBadge>{copy.provider.modelsCount(provider.models.length)}</ModelBadge>
            ) : (
              <ModelBadge>{copy.provider.modelsAvailable(provider.models.length)}</ModelBadge>
            )}
          </div>
        </div>

        <div className="hidden md:block">
          <ModelBadge>{copy.provider.llmBadge}</ModelBadge>
        </div>

        <div>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-0 text-[12px] font-medium text-foreground transition hover:text-primary"
            aria-label={
              expanded ? copy.provider.modelsCount(visibleModels.length) : copy.provider.showModels
            }
            onClick={handleToggleModelList}
          >
            {loadingModels ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
                  expanded && "rotate-90"
                )}
              />
            )}
            <span>
              {hasProviderError
                ? copy.provider.retryModels
                : visibleModels.length > 0
                  ? copy.provider.modelsCount(visibleModels.length)
                  : copy.provider.showModels}
            </span>
          </button>
          {hasProviderError ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-destructive md:hidden">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={provider.modelListError}>
                {provider.modelListError}
              </span>
            </div>
          ) : notConfigured ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground md:hidden">
              <Info className="h-3.5 w-3.5 shrink-0 text-status-info" />
              <span className="truncate">{copy.provider.configureTip}</span>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 md:text-right">
          <CredentialPanel provider={provider} onOpenProviderDialog={handleOpenCredentialDialog} />
          {hasProviderError ? (
            <div className="mt-1 hidden min-w-0 items-center justify-end gap-1 text-[11px] text-destructive md:flex">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={provider.modelListError}>
                {provider.modelListError}
              </span>
            </div>
          ) : notConfigured ? (
            <div className="mt-1 hidden min-w-0 items-center justify-end gap-1 text-[11px] text-muted-foreground md:flex">
              <Info className="h-3.5 w-3.5 shrink-0 text-status-info" />
              <span className="truncate">{copy.provider.configureTip}</span>
            </div>
          ) : null}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-background/35">
          <ModelList models={visibleModels} defaultModelId={defaultModelId} />
        </div>
      )}

      {modelLoadError && (
        <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
          {modelLoadError}
        </div>
      )}
    </div>
  )
}

export default memo(ProviderAddedCard)
