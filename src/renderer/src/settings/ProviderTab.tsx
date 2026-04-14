import { useCallback, useEffect, useMemo, useState } from "react"
import ModelProviderPage from "@/features/model-provider/model-provider-page"
import type { ModelConfig, Provider, ProviderId } from "../../../shared/app-types"
import type { AppLocale } from "../../../shared/i18n"
import type { SettingsWindowTarget } from "../../../shared/settings-window"
import { ApiKeyDialog } from "../components/chat/ApiKeyDialog"

type ProviderTabProps = {
  focusTarget: SettingsWindowTarget | null
  locale: AppLocale
  onFocusTargetConsumed: () => void
}

export function ProviderTab(props: ProviderTabProps): React.JSX.Element {
  const { focusTarget, locale, onFocusTargetConsumed } = props
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [defaultModelId, setDefaultModelId] = useState("")
  const [dialogProviderId, setDialogProviderId] = useState<ProviderId | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      const [providerState, nextDefaultModelId] = await Promise.all([
        window.api.models.getState(),
        window.api.models.getDefault()
      ])

      setProviders(providerState.providers)
      setModels(providerState.models)
      setDefaultModelId(nextDefaultModelId)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
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
    await window.api.models.setDefault(nextModelId)
    setDefaultModelId(nextModelId)
  }

  const handleOpenProviderDialog = (providerId: ProviderId): void => {
    setDialogProviderId(providerId)
    setDialogOpen(true)
  }

  const handleLoadProviderModels = (providerId: ProviderId): Promise<ModelConfig[]> => {
    return window.api.models.listByProvider(providerId).then((nextModels) => {
      setModels((currentModels) => [
        ...currentModels.filter((model) => model.provider !== providerId),
        ...nextModels
      ])
      setProviders((currentProviders) =>
        currentProviders.map((provider) =>
          provider.id === providerId
            ? { ...provider, modelError: undefined, modelStatus: "available" }
            : provider
        )
      )
      return nextModels
    })
  }

  const handleDialogOpenChange = (nextOpen: boolean): void => {
    setDialogOpen(nextOpen)
    if (!nextOpen) {
      setDialogProviderId(null)
      void loadData()
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        {locale === "zh-CN" ? "正在加载模型配置..." : "Loading model providers..."}
      </div>
    )
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
