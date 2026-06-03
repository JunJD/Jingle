import { useCallback, useEffect, useState } from "react"
import { ModelSetupSurface } from "./ModelSetupSurface"
import type {
  CustomProviderInput,
  DefaultModelOptions,
  ModelConfig,
  ModelProviderPaths,
  Provider,
  ProviderId,
  SetDefaultModelOptions
} from "@shared/app-types"

interface ModelOnboardingGuardProps {
  children: React.ReactNode
}

interface OnboardingState {
  activeProviderId: ProviderId | null
  defaultModelId: string
  defaultModelOptions: DefaultModelOptions["llm"]
  modelProviderPaths: ModelProviderPaths | null
  models: ModelConfig[]
  providers: Provider[]
}

export function ModelOnboardingGuard(props: ModelOnboardingGuardProps): React.JSX.Element {
  const { children } = props
  const [state, setState] = useState<OnboardingState | null>(null)
  const [loading, setLoading] = useState(true)

  const loadState = useCallback(async (): Promise<void> => {
    const [providerState, models, modelProviderPaths] = await Promise.all([
      window.api.models.getState(),
      window.api.models.list("llm"),
      window.api.models.getPaths()
    ])

    setState({
      activeProviderId: providerState.activeProviderId,
      defaultModelId: providerState.defaultModels.llm,
      defaultModelOptions: providerState.defaultModelOptions.llm,
      modelProviderPaths,
      models,
      providers: providerState.providers
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      try {
        await loadState()
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [loadState])

  if (loading || !state) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="h-[var(--ow-shimmer-track-h)] w-[var(--ow-shimmer-track-w)] overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[var(--ow-shimmer-thumb-w)] animate-[glide_1.2s_ease-in-out_infinite] rounded-full bg-foreground/55" />
        </div>
      </div>
    )
  }

  const defaultProviderId = getProviderIdFromModelId(state.defaultModelId)
  const configured = state.providers.some(
    (provider) =>
      provider.id === defaultProviderId && provider.customConfiguration.status === "active"
  )
  if (configured) {
    return <>{children}</>
  }

  return (
    <ModelSetupSurface
      activeProviderId={state.activeProviderId}
      defaultModelId={state.defaultModelId}
      defaultModelOptions={state.defaultModelOptions}
      modelProviderPaths={state.modelProviderPaths}
      models={state.models}
      providers={state.providers}
      title="欢迎使用 Jingle"
      variant="onboarding"
      onCreateCustomProvider={async (provider: CustomProviderInput) => {
        const providerId = await window.api.models.upsertCustomProvider(provider)
        await loadState()
        return providerId
      }}
      onRefresh={loadState}
      onSelectModel={async (modelId, options?: SetDefaultModelOptions) => {
        await window.api.models.setDefault("llm", modelId, options)
        await loadState()
      }}
    />
  )
}

function getProviderIdFromModelId(modelId: string): ProviderId | null {
  const separatorIndex = modelId.indexOf(":")
  return separatorIndex > 0 ? modelId.slice(0, separatorIndex) : null
}
