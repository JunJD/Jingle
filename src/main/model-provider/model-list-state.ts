import type { ModelConfig, Provider, ProviderId } from "./types"

export interface ProviderModelListState {
  error?: string
  models: ModelConfig[]
  status: Provider["modelListStatus"]
}

const providerModelListStates = new Map<ProviderId, ProviderModelListState>()

export function getProviderModelListState(providerId: ProviderId): ProviderModelListState | null {
  return providerModelListStates.get(providerId) ?? null
}

export function setProviderModelListSuccess(providerId: ProviderId, models: ModelConfig[]): void {
  providerModelListStates.set(providerId, {
    models,
    status: "active"
  })
}

export function setProviderModelListError(providerId: ProviderId, error: string): void {
  providerModelListStates.set(providerId, {
    error,
    models: [],
    status: "error"
  })
}

export function clearProviderModelListState(providerId: ProviderId): void {
  providerModelListStates.delete(providerId)
}

export function clearProviderModelListStates(): void {
  providerModelListStates.clear()
}
