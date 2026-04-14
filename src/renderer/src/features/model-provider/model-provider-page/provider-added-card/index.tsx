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

function getProviderCardClassName(provider: ProviderId): string {
  switch (provider) {
    case "openai":
      return "bg-[linear-gradient(135deg,rgba(236,253,245,0.85),rgba(255,255,255,0.92))]"
    case "anthropic":
      return "bg-[linear-gradient(135deg,rgba(255,247,237,0.9),rgba(255,255,255,0.92))]"
    case "google":
      return "bg-[linear-gradient(135deg,rgba(239,246,255,0.9),rgba(255,255,255,0.92))]"
    case "dashscope":
      return "bg-[linear-gradient(135deg,rgba(254,249,195,0.72),rgba(255,255,255,0.92))]"
  }

  const exhaustiveProvider: never = provider
  throw new Error(`Provider card style is not implemented: ${exhaustiveProvider}`)
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
  const hasProviderError = provider.modelStatus === "error"
  const visibleModels =
    provider.models.length > 0 ? provider.models : (loadedModels ?? provider.models)

  const handleOpenModelList = async (): Promise<void> => {
    if (loadingModels) {
      return
    }

    if (!hasProviderError && visibleModels.length > 0) {
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
        "mb-2 overflow-hidden rounded-2xl border border-border/80 shadow-[0_12px_36px_rgba(32,38,45,0.06)]",
        hasProviderError && "border-destructive/35",
        getProviderCardClassName(provider.provider)
      )}
    >
      <div className="flex rounded-t-2xl py-3 pl-4 pr-3">
        <div className="grow px-1 pb-0.5 pt-1">
          <div className="mb-2 flex items-center gap-1">
            <ProviderIcon provider={provider} />
          </div>
          <div className="flex flex-wrap gap-1">
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

        <CredentialPanel provider={provider} onOpenProviderDialog={handleOpenCredentialDialog} />
      </div>

      <div className="flex min-h-9 items-center justify-between border-t border-border/70 py-1.5 pl-2 pr-[11px] text-[12px] font-medium text-muted-foreground">
        <button
          type="button"
          className="flex h-6 items-center rounded-lg pl-1 pr-1.5 hover:bg-background-secondary"
          aria-label={
            expanded ? copy.provider.modelsCount(visibleModels.length) : copy.provider.showModels
          }
          onClick={handleToggleModelList}
        >
          {hasProviderError
            ? copy.provider.retryModels
            : visibleModels.length > 0
              ? copy.provider.modelsCount(visibleModels.length)
              : copy.provider.showModels}
          {loadingModels ? (
            <Loader2 className="ml-0.5 h-3 w-3 animate-spin" />
          ) : (
            <ChevronRight
              className={cn("h-4 w-4 transition-transform duration-150", expanded && "rotate-90")}
            />
          )}
        </button>

        {hasProviderError ? (
          <div className="flex min-w-0 items-center gap-1 pl-2 text-[12px] text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate" title={provider.modelError}>
              {provider.modelError}
            </span>
          </div>
        ) : notConfigured ? (
          <div className="flex min-w-0 items-center gap-1 pl-2 text-[12px] text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 text-blue-500" />
            <span className="truncate">{copy.provider.configureTip}</span>
          </div>
        ) : null}
      </div>

      {expanded && <ModelList models={visibleModels} defaultModelId={defaultModelId} />}

      {modelLoadError && (
        <div className="border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {modelLoadError}
        </div>
      )}
    </div>
  )
}

export default memo(ProviderAddedCard)
