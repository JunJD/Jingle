import { deleteProviderSecret, getProviderSecret, setProviderSecret } from "../preferences"
import type { ProviderId } from "./types"

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
