import type {
  DefaultModelOptions,
  ModelConfig,
  ModelProviderPaths,
  Provider,
  ProviderId
} from "@shared/app-types"

export type ProviderTabData = {
  activeProviderId: ProviderId | null
  defaultModelId: string
  defaultModelOptions: DefaultModelOptions["llm"]
  modelProviderPaths: ModelProviderPaths | null
  models: ModelConfig[]
  providers: Provider[]
}

let providerTabDataCache: ProviderTabData | null = null
let providerTabDataRequest: Promise<ProviderTabData> | null = null

export function getCachedProviderTabData(): ProviderTabData | null {
  return providerTabDataCache
}

export function updateCachedProviderTabData(
  update: (current: ProviderTabData) => ProviderTabData
): void {
  if (providerTabDataCache) {
    providerTabDataCache = update(providerTabDataCache)
  }
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

export function loadProviderTabData(force = false): Promise<ProviderTabData> {
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

export function preloadProviderTabData(): void {
  void loadProviderTabData()
}
