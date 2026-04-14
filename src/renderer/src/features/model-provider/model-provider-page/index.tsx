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

  return (
    <div className="relative -mt-2 pt-1">
      <div className="mb-4 overflow-hidden rounded-[26px] border border-border/70 bg-[radial-gradient(circle_at_8%_0%,rgba(254,243,199,0.95),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(248,250,252,0.78))] px-5 py-4 shadow-[0_18px_55px_rgba(32,38,45,0.08)]">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background-elevated shadow-sm">
            <Brain className="h-5 w-5 text-foreground" />
          </div>
          <div className="min-w-0 grow">
            <div className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
              {copy.provider.sectionTitle}
            </div>
            <div className="mt-1 max-w-[620px] text-[13px] leading-5 text-muted-foreground">
              {copy.provider.description}
            </div>
            {showWarning && (
              <div className="mt-3 hidden w-fit max-w-full items-center gap-1 rounded-xl border border-amber-200 bg-amber-50/80 px-2 py-1 text-[12px] font-medium text-amber-900 shadow-sm md:flex">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span className="truncate" title={copy.provider.defaultModelUnavailable}>
                  {copy.provider.defaultModelUnavailable}
                </span>
              </div>
            )}
          </div>

          <div className="shrink-0">
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
        <div className="mb-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-[12px] leading-5 text-destructive">
          {loadError}
        </div>
      )}

      {!!configuredProviders.length && (
        <div className="mb-3 flex items-center gap-3">
          <div className="min-w-0 grow">
            <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.provider.connectedSection}
            </div>
          </div>
        </div>
      )}

      {!configuredProviders.length && (
        <div className="mb-2 rounded-2xl border border-dashed border-border/80 bg-background-secondary/45 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background-elevated shadow-sm">
            <Brain className="h-5 w-5 text-foreground" />
          </div>
          <div className="mt-2 text-[14px] font-medium text-foreground">
            {copy.provider.emptyStateTitle}
          </div>
          <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
            {copy.provider.emptyStateTip}
          </div>
        </div>
      )}

      {!!configuredProviders.length && (
        <div className="relative">
          {configuredProviders.map((provider) => (
            <ProviderAddedCard
              key={provider.provider}
              provider={provider}
              defaultModelId={defaultModelId}
              onLoadProviderModels={onLoadProviderModels}
              onOpenProviderDialog={onOpenProviderDialog}
            />
          ))}
        </div>
      )}

      {!!notConfiguredProviders.length && (
        <>
          <div className="mb-2 flex items-center pt-2 text-[14px] font-semibold text-foreground">
            {copy.provider.toBeConfigured}
          </div>
          <div className="relative">
            {notConfiguredProviders.map((provider) => (
              <ProviderAddedCard
                notConfigured
                key={provider.provider}
                provider={provider}
                defaultModelId={defaultModelId}
                onLoadProviderModels={onLoadProviderModels}
                onOpenProviderDialog={onOpenProviderDialog}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
