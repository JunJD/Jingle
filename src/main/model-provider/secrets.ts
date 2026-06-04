import {
  deleteProviderCredential as deleteStoredProviderCredential,
  deleteProviderCredentials as deleteStoredProviderCredentials,
  getProviderCredential as getStoredProviderCredential,
  hasProviderCredentials as hasStoredProviderCredentials,
  setProviderCredential as setStoredProviderCredential
} from "./auth-store"
import type { ProviderId } from "./types"

export function getProviderCredential(
  providerId: ProviderId,
  variable: string
): string | undefined {
  return getStoredProviderCredential(providerId, variable) ?? undefined
}

export function setProviderCredential(
  providerId: ProviderId,
  variable: string,
  value: string
): void {
  setStoredProviderCredential(providerId, variable, value.trim())
}

export function hasProviderCredentials(providerId: ProviderId, variables: string[]): boolean {
  return hasStoredProviderCredentials(providerId, variables)
}

export function deleteProviderCredential(providerId: ProviderId, variable: string): void {
  deleteStoredProviderCredential(providerId, variable)
}

export function deleteProviderCredentials(providerId: ProviderId, variables: string[]): void {
  deleteStoredProviderCredentials(providerId, variables)
}
