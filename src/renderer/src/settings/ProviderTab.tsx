import { useCallback, useEffect, useReducer } from "react"
import { ModelSetupSurface } from "@/features/model-provider/model-setup/ModelSetupSurface"
import type {
  CustomProviderInput,
  ModelConfig,
  Provider,
  ProviderId
} from "@shared/app-types"
import type { SettingsWindowTarget } from "@shared/settings-window"
import {
  getCachedProviderTabData,
  loadProviderTabData,
  updateCachedProviderTabData,
  type ProviderTabData
} from "./provider-tab-data"

type ProviderTabProps = {
  focusTarget: SettingsWindowTarget | null
  onFocusTargetConsumed: () => void
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

interface ProviderTabState {
  data: ProviderTabData
  loadError: string | null
  loading: boolean
}

type ProviderTabAction =
  | { type: "default-model-changed"; defaultModelId: string; options?: Parameters<typeof window.api.models.setDefault>[2] }
  | { type: "load-failed"; error: string }
  | { type: "load-started" }
  | { type: "loaded"; data: ProviderTabData }

function createEmptyProviderTabData(): ProviderTabData {
  return {
    activeProviderId: null,
    defaultModelId: "",
    defaultModelOptions: {},
    modelProviderPaths: null,
    models: [],
    providers: []
  }
}

function createProviderTabInitialState(cachedData: ProviderTabData | null): ProviderTabState {
  return {
    data: cachedData ?? createEmptyProviderTabData(),
    loadError: null,
    loading: cachedData === null
  }
}

function getProviderIdFromModelId(modelId: string): ProviderId | null {
  const separatorIndex = modelId.indexOf(":")
  return separatorIndex > 0 ? modelId.slice(0, separatorIndex) : null
}

function normalizeDefaultModelOptions(
  options: Parameters<typeof window.api.models.setDefault>[2] | undefined
): ProviderTabData["defaultModelOptions"] {
  return {
    thinkingEffort: options?.thinkingEffort ?? null
  }
}

function createDefaultOptionsForFirstProviderModel(
  model: ModelConfig
): ProviderTabData["defaultModelOptions"] {
  if (model.reasoning) {
    return {
      thinkingEffort: "high"
    }
  }

  return {
    thinkingEffort: null
  }
}

function getValidFocusProviderId(
  focusTarget: SettingsWindowTarget | null,
  providers: Provider[]
): ProviderId | null {
  if (!focusTarget?.providerId) {
    return null
  }

  if (providers.some((provider) => provider.id === focusTarget.providerId)) {
    return focusTarget.providerId
  }

  return null
}

function providerTabReducer(state: ProviderTabState, action: ProviderTabAction): ProviderTabState {
  switch (action.type) {
    case "default-model-changed":
      return {
        ...state,
        data: {
          ...state.data,
          activeProviderId: getProviderIdFromModelId(action.defaultModelId),
          defaultModelId: action.defaultModelId,
          defaultModelOptions: normalizeDefaultModelOptions(action.options)
        }
      }
    case "load-failed":
      return { ...state, loadError: action.error, loading: false }
    case "load-started":
      return { ...state, loadError: null, loading: true }
    case "loaded":
      return { data: action.data, loadError: null, loading: false }
  }
}

export function ProviderTab(props: ProviderTabProps): React.JSX.Element {
  const { focusTarget, onFocusTargetConsumed } = props
  const cachedProviderTabData = getCachedProviderTabData()
  const [state, dispatch] = useReducer(
    providerTabReducer,
    cachedProviderTabData,
    createProviderTabInitialState
  )
  const {
    data: {
      activeProviderId,
      defaultModelId,
      defaultModelOptions,
      modelProviderPaths,
      models,
      providers
    },
    loadError,
    loading
  } = state

  const loadData = useCallback(async (force = false): Promise<void> => {
    if (!getCachedProviderTabData()) {
      dispatch({ type: "load-started" })
    }
    try {
      const data = await loadProviderTabData(force)
      dispatch({ type: "loaded", data })
    } catch (error) {
      dispatch({
        type: "load-failed",
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [])

  useEffect(() => {
    void loadData(true)
  }, [loadData])

  const handleDefaultModelChange = useCallback(
    async (
      nextModelId: string,
      options?: Parameters<typeof window.api.models.setDefault>[2]
    ): Promise<void> => {
      await window.api.models.setDefault("llm", nextModelId, options)
      updateCachedProviderTabData((current) => ({
        ...current,
        activeProviderId: getProviderIdFromModelId(nextModelId),
        defaultModelId: nextModelId,
        defaultModelOptions: normalizeDefaultModelOptions(options)
      }))
      dispatch({ type: "default-model-changed", defaultModelId: nextModelId, options })
    },
    []
  )

  const handleCreateCustomProvider = async (provider: CustomProviderInput): Promise<ProviderId> => {
    const providerId = await window.api.models.upsertCustomProvider(provider)
    await loadData(true)
    return providerId
  }

  const handleSaveCredentials = useCallback(
    async (providerId: ProviderId, credentials: Record<string, string>): Promise<void> => {
      await window.api.models.setCredentials(providerId, credentials)
      await loadData(true)
    },
    [loadData]
  )

  const handleDeleteCredentials = useCallback(
    async (providerId: ProviderId): Promise<void> => {
      await window.api.models.deleteCredentials(providerId)
      await loadData(true)
    },
    [loadData]
  )

  const handleActivateProvider = useCallback(
    async (providerId: ProviderId): Promise<void> => {
      const response = await window.api.models.listByProvider(providerId, "llm")
      const firstModel = response.models[0]
      if (!firstModel) {
        throw new Error(`Provider has no available model: ${providerId}`)
      }
      await handleDefaultModelChange(
        firstModel.id,
        createDefaultOptionsForFirstProviderModel(firstModel)
      )
    },
    [handleDefaultModelChange]
  )

  if (loading) {
    return <ProviderTabSkeleton />
  }

  const focusProviderId = getValidFocusProviderId(focusTarget, providers)

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
        onActivateProvider={handleActivateProvider}
        onCreateCustomProvider={handleCreateCustomProvider}
        onDeleteCredentials={handleDeleteCredentials}
        onFocusProviderConsumed={onFocusTargetConsumed}
        onRefresh={() => loadData(true)}
        onSaveCredentials={handleSaveCredentials}
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
