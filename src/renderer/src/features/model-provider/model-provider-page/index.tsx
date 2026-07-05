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
    <div className="relative pb-[var(--ow-space-4)]">
      <div className="mb-[var(--ow-space-4)] border-b border-border-emphasis pb-[var(--ow-space-4)]">
        <div className="flex flex-col items-start justify-between gap-[var(--ow-gap-lg)] sm:flex-row sm:gap-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-meta)] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <Brain className="h-3.5 w-3.5" />
              {copy.provider.registryLabel}
            </div>
            <div className="[font-size:var(--ow-settings-title-size)] font-semibold tracking-normal text-foreground">
              {copy.provider.sectionTitle}
            </div>
            <div className="mt-[var(--ow-space-1)] max-w-[var(--ow-model-provider-copy-max-width)] [font-size:var(--ow-settings-description-size)] leading-[var(--ow-line-body)] text-muted-foreground">
              {copy.provider.description}
            </div>
            {showWarning && (
              <div className="mt-[var(--ow-space-3)] flex w-fit max-w-full items-center gap-[var(--ow-gap-sm)] border-l-2 border-status-warning bg-transparent py-[var(--ow-space-0-5)] pl-[var(--ow-space-2)] [font-size:var(--ow-font-body)] font-medium text-status-warning">
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
        <div className="mb-[var(--ow-space-3)] rounded-[var(--ow-settings-card-radius)] border border-destructive/25 bg-destructive/10 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-destructive">
          {loadError}
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--ow-settings-card-radius)] border border-border-emphasis bg-background-elevated/55 shadow-[var(--ow-settings-card-shadow)]">
        <div className="hidden grid-cols-[minmax(210px,1.1fr)_112px_132px_minmax(230px,1fr)] border-b border-border bg-background-secondary/55 px-[var(--ow-settings-card-x)] py-[var(--ow-space-2)] [font-size:var(--ow-font-caption)] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:grid">
          <div>{copy.provider.providerColumn}</div>
          <div>{copy.provider.typeColumn}</div>
          <div>{copy.provider.modelsColumn}</div>
          <div className="text-right">{copy.provider.credentialColumn}</div>
        </div>

        {!providerRows.length ? (
          <div className="px-[var(--ow-settings-card-x)] py-8">
            <div className="flex items-start gap-[var(--ow-gap-md)]">
              <div className="mt-0.5 h-2 w-2 rounded-full bg-status-warning" />
              <div>
                <div className="[font-size:var(--ow-font-title)] font-medium text-foreground">
                  {copy.provider.emptyStateTitle}
                </div>
                <div className="mt-[var(--ow-space-1)] max-w-[var(--ow-dialog-w-md)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
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
