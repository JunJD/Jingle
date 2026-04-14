import { deleteProviderSecret, getProviderSecret, setProviderSecret } from "../preferences"
import { API_KEY_CREDENTIAL_VARIABLE } from "./catalog"
import type { ProviderId } from "./types"

export function getProviderApiKey(providerId: ProviderId): string | undefined {
  return getProviderCredential(providerId, API_KEY_CREDENTIAL_VARIABLE)
}

export function setProviderApiKey(providerId: ProviderId, apiKey: string): void {
  setProviderCredential(providerId, API_KEY_CREDENTIAL_VARIABLE, apiKey)
}

export function deleteProviderApiKey(providerId: ProviderId): void {
  deleteProviderCredential(providerId, API_KEY_CREDENTIAL_VARIABLE)
}

export function hasProviderApiKey(providerId: ProviderId): boolean {
  return Boolean(getProviderApiKey(providerId))
}

export function getProviderCredential(
  providerId: ProviderId,
  variable: string
): string | undefined {
  return getProviderSecret(providerId, variable) ?? undefined
}

export function setProviderCredential(
  providerId: ProviderId,
  variable: string,
  value: string
): void {
  setProviderSecret(providerId, variable, value.trim())
}

export function deleteProviderCredential(providerId: ProviderId, variable: string): void {
  deleteProviderSecret(providerId, variable)
}

export function deleteProviderCredentials(providerId: ProviderId, variables: string[]): void {
  variables.forEach((variable) => deleteProviderCredential(providerId, variable))
}
