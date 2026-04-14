import { useMemo } from "react"
import type { ModelConfig, Provider } from "@/types"
import { sortModelProviders, toModelProvider, type ModelProvider } from "./declarations"

type ModelProviderPageStateInput = {
  defaultModelId: string
  models: ModelConfig[]
  providers: Provider[]
}

type ModelProviderPageState = {
  availableModels: ModelConfig[]
  configuredProviders: ModelProvider[]
  defaultModel: ModelConfig | undefined
  notConfiguredProviders: ModelProvider[]
  showWarning: boolean
}

export function useModelProviderPageState(
  input: ModelProviderPageStateInput
): ModelProviderPageState {
  const { defaultModelId, models, providers } = input

  return useMemo(() => {
    const pageProviders = sortModelProviders(
      providers.map((provider) => toModelProvider(provider, models))
    )
    const configuredProviders: ModelProvider[] = []
    const notConfiguredProviders: ModelProvider[] = []

    pageProviders.forEach((provider) => {
      if (provider.configurationStatus === "active") {
        configuredProviders.push(provider)
        return
      }

      notConfiguredProviders.push(provider)
    })

    const availableModels = models.filter(
      (model) => model.modelType === "llm" && model.status === "active"
    )
    const defaultModel = models.find((model) => model.id === defaultModelId)

    return {
      availableModels,
      configuredProviders,
      defaultModel,
      notConfiguredProviders,
      showWarning: defaultModel?.status !== "active"
    }
  }, [defaultModelId, models, providers])
}
