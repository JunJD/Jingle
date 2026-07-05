import { useCallback, useEffect, useState } from "react"
import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
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

function createDefaultOptionsForActivatedModel(
  model: ModelConfig
): DefaultModelOptions["llm"] {
  if (model.reasoning) {
    return {
      thinkingEffort: "high"
    }
  }

  return {
    thinkingEffort: null
  }
}

export function ModelOnboardingGuard(props: ModelOnboardingGuardProps): React.JSX.Element {
  const { children } = props
  const [state, setState] = useState<OnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [startupError, setStartupError] = useState<string | null>(null)

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
  const showStartupError = useCallback((error: unknown): void => {
    console.error("[ModelOnboardingGuard] Failed to inspect model provider state.", error)
    setState(null)
    setStartupError(error instanceof Error ? error.message : String(error))
  }, [])
  const retryStartupCheck = useCallback(async (): Promise<void> => {
    setLoading(true)
    setStartupError(null)
    try {
      await loadState()
    } catch (error) {
      showStartupError(error)
    } finally {
      setLoading(false)
    }
  }, [loadState, showStartupError])

  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      try {
        await loadState()
      } catch (error) {
        if (!cancelled) {
          showStartupError(error)
        }
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
  }, [loadState, showStartupError])

  if (startupError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-[var(--ow-space-5)] text-foreground">
        <div className="flex w-full max-w-[420px] flex-col items-center text-center">
          <div className="mb-[var(--ow-space-4)] flex size-10 items-center justify-center rounded-full bg-status-critical/12 text-status-critical">
            <CircleAlert className="size-[var(--ow-icon-md)]" />
          </div>
          <h1 className="[font-size:var(--ow-font-title)] font-medium leading-[var(--ow-line-tight)]">
            模型配置检查失败
          </h1>
          <p className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
            无法读取模型提供商状态，请重试或打开开发者日志查看具体错误。
          </p>
          <div className="mt-[var(--ow-space-3)] max-w-full rounded-[var(--ow-radius-md)] bg-muted px-[var(--ow-space-3)] py-[var(--ow-space-2)] font-mono [font-size:var(--ow-font-meta)] leading-[var(--ow-line-meta)] text-muted-foreground">
            {startupError}
          </div>
          <Button
            className="mt-[var(--ow-space-5)]"
            disabled={loading}
            onClick={() => {
              void retryStartupCheck()
            }}
            type="button"
          >
            重试
          </Button>
        </div>
      </div>
    )
  }

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
      onActivateProvider={async (providerId: ProviderId) => {
        const response = await window.api.models.listByProvider(providerId, "llm")
        const firstModel = response.models[0]
        if (!firstModel) {
          throw new Error(`Provider has no available model: ${providerId}`)
        }
        await window.api.models.setDefault(
          "llm",
          firstModel.id,
          createDefaultOptionsForActivatedModel(firstModel)
        )
        await loadState()
      }}
      onCreateCustomProvider={async (provider: CustomProviderInput) => {
        const providerId = await window.api.models.upsertCustomProvider(provider)
        await loadState()
        return providerId
      }}
      onDeleteCredentials={async (providerId: ProviderId) => {
        await window.api.models.deleteCredentials(providerId)
        await loadState()
      }}
      onRefresh={loadState}
      onSaveCredentials={async (providerId: ProviderId, credentials: Record<string, string>) => {
        await window.api.models.setCredentials(providerId, credentials)
        await loadState()
      }}
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
