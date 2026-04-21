import { useCallback, useEffect, useMemo, useState } from "react"
import ModelProviderPage from "@/features/model-provider/model-provider-page"
import type { ModelConfig, Provider, ProviderId } from "@shared/app-types"
import type { SettingsWindowTarget } from "@shared/settings-window"
import { ApiKeyDialog } from "../components/chat/ApiKeyDialog"

type ProviderTabData = {
  defaultModelId: string
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
  const [providerState, models] = await Promise.all([
    window.api.models.getState(),
    window.api.models.list("llm")
  ])

  return cacheProviderTabData({
    defaultModelId: providerState.defaultModels.llm,
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
    <div className="mx-auto w-full max-w-[1040px] space-y-4">
      <div className="h-[124px] animate-pulse rounded-[26px] border border-border/70 bg-background-secondary/70" />
      <div className="h-[118px] animate-pulse rounded-2xl border border-dashed border-border/80 bg-background-secondary/45" />
      <div className="space-y-2">
        <div className="h-[112px] animate-pulse rounded-2xl border border-border/80 bg-background-elevated/70" />
        <div className="h-[112px] animate-pulse rounded-2xl border border-border/80 bg-background-elevated/70" />
      </div>
    </div>
  )
}

export function ProviderTab(props: ProviderTabProps): React.JSX.Element {
  const { focusTarget, onFocusTargetConsumed } = props
  const [providers, setProviders] = useState<Provider[]>(
    () => providerTabDataCache?.providers ?? []
  )
  const [models, setModels] = useState<ModelConfig[]>(() => providerTabDataCache?.models ?? [])
  const [defaultModelId, setDefaultModelId] = useState(
    () => providerTabDataCache?.defaultModelId ?? ""
  )
  const [dialogProviderId, setDialogProviderId] = useState<ProviderId | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loading, setLoading] = useState(() => providerTabDataCache === null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async (force = false): Promise<void> => {
    if (!providerTabDataCache) {
      setLoading(true)
    }
    setLoadError(null)
    try {
      const data = await loadProviderTabData(force)

      setProviders(data.providers)
      setModels(data.models)
      setDefaultModelId(data.defaultModelId)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(true)
  }, [loadData])

  useEffect(() => {
    if (!focusTarget?.providerId) {
      return
    }

    const targetProvider = providers.find((provider) => provider.id === focusTarget.providerId)
    if (!targetProvider) {
      return
    }

    setDialogProviderId(targetProvider.id)
    setDialogOpen(true)
    onFocusTargetConsumed()
  }, [focusTarget?.providerId, onFocusTargetConsumed, providers])

  const providerMap = useMemo(() => {
    return new Map(providers.map((provider) => [provider.id, provider]))
  }, [providers])

  const dialogProvider = dialogProviderId ? (providerMap.get(dialogProviderId) ?? null) : null

  const handleDefaultModelChange = async (nextModelId: string): Promise<void> => {
    await window.api.models.setDefault("llm", nextModelId)
    if (providerTabDataCache) {
      providerTabDataCache = {
        ...providerTabDataCache,
        defaultModelId: nextModelId
      }
    }
    setDefaultModelId(nextModelId)
  }

  const handleOpenProviderDialog = (providerId: ProviderId): void => {
    setDialogProviderId(providerId)
    setDialogOpen(true)
  }

  const handleLoadProviderModels = (providerId: ProviderId): Promise<ModelConfig[]> => {
    return window.api.models.listByProvider(providerId, "llm").then((response) => {
      const nextModels = response.models
      setModels((currentModels) => [
        ...currentModels.filter((model) => model.provider !== providerId),
        ...nextModels
      ])
      setProviders((currentProviders) =>
        currentProviders.map((provider) =>
          provider.id === providerId ? response.provider : provider
        )
      )
      if (providerTabDataCache) {
        providerTabDataCache = {
          ...providerTabDataCache,
          models: [
            ...providerTabDataCache.models.filter((model) => model.provider !== providerId),
            ...nextModels
          ],
          providers: providerTabDataCache.providers.map((provider) =>
            provider.id === providerId ? response.provider : provider
          )
        }
      }
      return nextModels
    })
  }

  const handleDialogOpenChange = (nextOpen: boolean): void => {
    setDialogOpen(nextOpen)
    if (!nextOpen) {
      setDialogProviderId(null)
      void loadData(true)
    }
  }

  if (loading) {
    return <ProviderTabSkeleton />
  }

  return (
    <>
      <div className="mx-auto w-full max-w-[1040px]">
        <ModelProviderPage
          providers={providers}
          models={models}
          defaultModelId={defaultModelId}
          loadError={loadError}
          onDefaultModelChange={handleDefaultModelChange}
          onLoadProviderModels={handleLoadProviderModels}
          onOpenProviderDialog={handleOpenProviderDialog}
        />
      </div>

      <ApiKeyDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        provider={dialogProvider}
      />
    </>
  )
}
