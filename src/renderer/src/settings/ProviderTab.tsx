import { useCallback, useEffect, useState } from "react"
import { ModelSetupSurface } from "@/features/model-provider/model-setup/ModelSetupSurface"
import type {
  CustomProviderInput,
  DefaultModelOptions,
  ModelConfig,
  ModelProviderPaths,
  Provider,
  ProviderId
} from "@shared/app-types"
import type { SettingsWindowTarget } from "@shared/settings-window"

type ProviderTabData = {
  activeProviderId: ProviderId | null
  defaultModelId: string
  defaultModelOptions: DefaultModelOptions["llm"]
  modelProviderPaths: ModelProviderPaths | null
  models: ModelConfig[]
  providers: Provider[]
}

let providerTabDataCache: ProviderTabData | null = null
let providerTabDataRequest: Promise<ProviderTabData> | null = null

type ProviderTabProps = {
  focusTarget: SettingsWindowTarget | null
  onFocusTargetConsumed: () => void
}

function cacheProviderTabData(data: ProviderTabData): ProviderTabData {
  providerTabDataCache = data
  return data
}

async function fetchProviderTabData(): Promise<ProviderTabData> {
  const [providerState, models, modelProviderPaths] = await Promise.all([
    window.api.models.getState(),
    window.api.models.list("llm"),
    window.api.models.getPaths()
  ])

  return cacheProviderTabData({
    activeProviderId: providerState.activeProviderId,
    defaultModelId: providerState.defaultModels.llm,
    defaultModelOptions: providerState.defaultModelOptions.llm,
    modelProviderPaths,
    models,
    providers: providerState.providers
  })
}

function loadProviderTabData(force = false): Promise<ProviderTabData> {
  if (!force && providerTabDataCache) {
    return Promise.resolve(providerTabDataCache)
  }

  if (force || !providerTabDataRequest) {
    providerTabDataRequest = fetchProviderTabData().finally(() => {
      providerTabDataRequest = null
    })
  }

  return providerTabDataRequest
}

// eslint-disable-next-line react-refresh/only-export-components
export function preloadProviderTabData(): void {
  void loadProviderTabData()
}

function ProviderTabSkeleton(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[var(--ow-settings-content-max-width)] space-y-[var(--ow-space-4)]">
      <div className="h-[var(--ow-settings-provider-skeleton-lg)] animate-pulse rounded-[var(--ow-radius-panel)] border border-border/70 bg-background-secondary/70" />
      <div className="h-[var(--ow-settings-provider-skeleton-md)] animate-pulse rounded-[var(--ow-radius-panel)] border border-dashed border-border/80 bg-background-secondary/45" />
      <div className="space-y-[var(--ow-space-2)]">
        <div className="h-[var(--ow-settings-provider-skeleton-sm)] animate-pulse rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-elevated/70" />
        <div className="h-[var(--ow-settings-provider-skeleton-sm)] animate-pulse rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-elevated/70" />
      </div>
    </div>
  )
}

export function ProviderTab(props: ProviderTabProps): React.JSX.Element {
  const { focusTarget, onFocusTargetConsumed } = props
  const [providers, setProviders] = useState<Provider[]>(
    () => providerTabDataCache?.providers ?? []
  )
  const [activeProviderId, setActiveProviderId] = useState<ProviderId | null>(
    () => providerTabDataCache?.activeProviderId ?? null
  )
  const [models, setModels] = useState<ModelConfig[]>(() => providerTabDataCache?.models ?? [])
  const [defaultModelId, setDefaultModelId] = useState(
    () => providerTabDataCache?.defaultModelId ?? ""
  )
  const [defaultModelOptions, setDefaultModelOptions] = useState<DefaultModelOptions["llm"]>(
    () => providerTabDataCache?.defaultModelOptions ?? {}
  )
  const [modelProviderPaths, setModelProviderPaths] = useState<ModelProviderPaths | null>(
    () => providerTabDataCache?.modelProviderPaths ?? null
  )
  const [loading, setLoading] = useState(() => providerTabDataCache === null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async (force = false): Promise<void> => {
    if (!providerTabDataCache) {
      setLoading(true)
    }
    setLoadError(null)
    try {
      const data = await loadProviderTabData(force)

      setActiveProviderId(data.activeProviderId)
      setProviders(data.providers)
      setModels(data.models)
      setDefaultModelId(data.defaultModelId)
      setDefaultModelOptions(data.defaultModelOptions)
      setModelProviderPaths(data.modelProviderPaths)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(true)
  }, [loadData])

  const handleDefaultModelChange = async (
    nextModelId: string,
    options?: Parameters<typeof window.api.models.setDefault>[2]
  ): Promise<void> => {
    await window.api.models.setDefault("llm", nextModelId, options)
    if (providerTabDataCache) {
      providerTabDataCache = {
        ...providerTabDataCache,
        activeProviderId: nextModelId.slice(0, nextModelId.indexOf(":")),
        defaultModelId: nextModelId,
        defaultModelOptions: {
          thinkingEffort: options?.thinkingEffort ?? null
        }
      }
    }
    setActiveProviderId(nextModelId.slice(0, nextModelId.indexOf(":")))
    setDefaultModelId(nextModelId)
    setDefaultModelOptions({
      thinkingEffort: options?.thinkingEffort ?? null
    })
  }

  const handleCreateCustomProvider = async (provider: CustomProviderInput): Promise<ProviderId> => {
    const providerId = await window.api.models.upsertCustomProvider(provider)
    await loadData(true)
    return providerId
  }

  if (loading) {
    return <ProviderTabSkeleton />
  }

  const focusProviderId =
    focusTarget?.providerId && providers.some((provider) => provider.id === focusTarget.providerId)
      ? focusTarget.providerId
      : null

  return (
    <div className="mx-auto w-full max-w-[var(--ow-settings-content-max-width)]">
      <ModelSetupSurface
        activeProviderId={activeProviderId}
        providers={providers}
        models={models}
        defaultModelId={defaultModelId}
        defaultModelOptions={defaultModelOptions}
        focusProviderId={focusProviderId}
        modelProviderPaths={modelProviderPaths}
        onCreateCustomProvider={handleCreateCustomProvider}
        onFocusProviderConsumed={onFocusTargetConsumed}
        onRefresh={() => loadData(true)}
        onSelectModel={handleDefaultModelChange}
        variant="settings"
      />
      {loadError && (
        <div className="mt-[var(--ow-space-3)] rounded-[var(--ow-settings-card-radius)] border border-destructive/25 bg-destructive/10 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-destructive">
          {loadError}
        </div>
      )}
    </div>
  )
}
