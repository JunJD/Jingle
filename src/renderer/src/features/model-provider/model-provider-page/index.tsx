import { AlertTriangle, Brain } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { getSettingsCopy } from "@/settings/copy"
import type { ModelConfig, Provider, ProviderId } from "@/types"
import { useModelProviderPageState } from "./hooks"
import ProviderAddedCard from "./provider-added-card"
import SystemModelSelector from "./system-model-selector"

type ModelProviderPageProps = {
  defaultModelId: string
  loadError: string | null
  models: ModelConfig[]
  onDefaultModelChange: (modelId: string) => Promise<void>
  onLoadProviderModels: (providerId: ProviderId) => Promise<ModelConfig[]>
  onOpenProviderDialog: (providerId: ProviderId) => void
  providers: Provider[]
}

export default function ModelProviderPage(props: ModelProviderPageProps): React.JSX.Element {
  const {
    defaultModelId,
    loadError,
    models,
    onDefaultModelChange,
    onLoadProviderModels,
    onOpenProviderDialog,
    providers
  } = props
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const {
    availableModels,
    configuredProviders,
    defaultModel,
    notConfiguredProviders,
    showWarning
  } = useModelProviderPageState({
    defaultModelId,
    models,
    providers
  })
  const providerRows = [...configuredProviders, ...notConfiguredProviders]

  return (
    <div className="relative -mt-1 pb-6">
      <div className="mb-5 border-b border-border-emphasis pb-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:gap-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <Brain className="h-3.5 w-3.5" />
              {copy.provider.registryLabel}
            </div>
            <div className="text-[20px] font-semibold tracking-normal text-foreground">
              {copy.provider.sectionTitle}
            </div>
            <div className="mt-1 max-w-[660px] text-[13px] leading-5 text-muted-foreground">
              {copy.provider.description}
            </div>
            {showWarning && (
              <div className="mt-3 flex w-fit max-w-full items-center gap-2 border-l-2 border-status-warning bg-transparent py-0.5 pl-2 text-[12px] font-medium text-status-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate" title={copy.provider.defaultModelUnavailable}>
                  {copy.provider.defaultModelUnavailable}
                </span>
              </div>
            )}
          </div>

          <div className="shrink-0 pt-1">
            <SystemModelSelector
              availableModels={availableModels}
              defaultModel={defaultModel}
              notConfigured={showWarning}
              onSave={onDefaultModelChange}
            />
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-3 rounded-[var(--ow-radius-panel)] border border-destructive/25 bg-destructive/10 px-4 py-3 text-[12px] leading-5 text-destructive">
          {loadError}
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--ow-radius-dialog)] border border-border-emphasis bg-background-elevated/55 shadow-[0_16px_40px_rgba(32,38,45,0.04)]">
        <div className="hidden grid-cols-[minmax(210px,1.1fr)_112px_132px_minmax(230px,1fr)] border-b border-border bg-background-secondary/55 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:grid">
          <div>{copy.provider.providerColumn}</div>
          <div>{copy.provider.typeColumn}</div>
          <div>{copy.provider.modelsColumn}</div>
          <div className="text-right">{copy.provider.credentialColumn}</div>
        </div>

        {!providerRows.length ? (
          <div className="px-4 py-8">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-2 w-2 rounded-full bg-status-warning" />
              <div>
                <div className="text-[14px] font-medium text-foreground">
                  {copy.provider.emptyStateTitle}
                </div>
                <div className="mt-1 max-w-[560px] text-[12px] leading-5 text-muted-foreground">
                  {copy.provider.emptyStateTip}
                </div>
              </div>
            </div>
          </div>
        ) : (
          providerRows.map((provider) => (
            <ProviderAddedCard
              notConfigured={provider.configurationStatus !== "active"}
              key={provider.provider}
              provider={provider}
              defaultModelId={defaultModelId}
              onLoadProviderModels={onLoadProviderModels}
              onOpenProviderDialog={onOpenProviderDialog}
            />
          ))
        )}
      </div>
    </div>
  )
}
