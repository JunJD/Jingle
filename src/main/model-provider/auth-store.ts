import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs"
import { mkdirSync } from "fs"
import { dirname } from "path"
import { getJingleAuthPath } from "./paths"
import type { ProviderId } from "./types"

interface StoredProviderCredential {
  value: string
}

interface ProviderAuthState {
  providers: Record<string, Record<string, StoredProviderCredential>>
}

const EMPTY_AUTH_STATE: ProviderAuthState = {
  providers: {}
}

export function getProviderCredential(
  providerId: ProviderId,
  variable: string
): string | undefined {
  return readAuthState().providers[providerId]?.[variable]?.value
}

export function hasProviderCredentials(providerId: ProviderId, variables: string[]): boolean {
  const providerAuth = readAuthState().providers[providerId] ?? {}
  return variables.every((variable) => Boolean(providerAuth[variable]?.value))
}

export function setProviderCredential(
  providerId: ProviderId,
  variable: string,
  value: string
): void {
  const state = readAuthState()
  const providerAuth = state.providers[providerId] ?? {}

  writeAuthState({
    providers: {
      ...state.providers,
      [providerId]: {
        ...providerAuth,
        [variable]: { value: value.trim() }
      }
    }
  })
}

export function deleteProviderCredential(providerId: ProviderId, variable: string): void {
  deleteProviderCredentials(providerId, [variable])
}

export function deleteProviderCredentials(providerId: ProviderId, variables: string[]): void {
  const state = readAuthState()
  const providerAuth = { ...(state.providers[providerId] ?? {}) }
  variables.forEach((variable) => {
    delete providerAuth[variable]
  })

  const providers = { ...state.providers }
  if (Object.keys(providerAuth).length > 0) {
    providers[providerId] = providerAuth
  } else {
    delete providers[providerId]
  }

  writeAuthState({ providers })
}

function readAuthState(): ProviderAuthState {
  const path = getJingleAuthPath()
  if (!existsSync(path)) {
    return EMPTY_AUTH_STATE
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ProviderAuthState>
  return {
    providers: normalizeProviderAuth(parsed.providers)
  }
}

function writeAuthState(state: ProviderAuthState): void {
  const path = getJingleAuthPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  })
  chmodSync(path, 0o600)
}

function normalizeProviderAuth(
  value: unknown
): Record<string, Record<string, StoredProviderCredential>> {
  if (!isRecord(value)) {
    return {}
  }

  const providers: Record<string, Record<string, StoredProviderCredential>> = {}
  for (const [providerId, providerAuth] of Object.entries(value)) {
    if (!isRecord(providerAuth)) {
      continue
    }

    const credentialRecord = Object.fromEntries(
      Object.entries(providerAuth).flatMap(([variable, credential]) => {
        if (!isRecord(credential) || typeof credential.value !== "string") {
          return []
        }

        return [[variable, { value: credential.value }]]
      })
    )
    if (Object.keys(credentialRecord).length > 0) {
      providers[providerId] = credentialRecord
    }
  }

  return providers
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
