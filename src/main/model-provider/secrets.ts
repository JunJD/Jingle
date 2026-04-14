import { deleteProviderSecret, getProviderSecret, setProviderSecret } from "../preferences"
import type { ProviderId } from "./types"

const API_KEY_SECRET_NAME = "apiKey"

export function getProviderApiKey(providerId: ProviderId): string | undefined {
  return getProviderSecret(providerId, API_KEY_SECRET_NAME) ?? undefined
}

export function setProviderApiKey(providerId: ProviderId, apiKey: string): void {
  setProviderSecret(providerId, API_KEY_SECRET_NAME, apiKey.trim())
}

export function deleteProviderApiKey(providerId: ProviderId): void {
  deleteProviderSecret(providerId, API_KEY_SECRET_NAME)
}

export function hasProviderApiKey(providerId: ProviderId): boolean {
  return Boolean(getProviderApiKey(providerId))
}
