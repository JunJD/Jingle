import { existsSync, readFileSync, writeFileSync } from "fs"
import { mkdirSync } from "fs"
import { dirname } from "path"
import { safeStorage } from "electron"
import { getJingleAuthPath } from "./paths"
import type { ProviderId } from "./types"

interface ProviderAuthState {
  providers: Record<string, Record<string, string>>
}

const EMPTY_AUTH_STATE: ProviderAuthState = {
  providers: {}
}

export function getProviderCredential(
  providerId: ProviderId,
  variable: string
): string | undefined {
  const encryptedValue = readAuthState().providers[providerId]?.[variable]
  return encryptedValue ? decryptValue(encryptedValue) : undefined
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
        [variable]: encryptValue(value.trim())
      }
    }
  })
}

export function deleteProviderCredential(providerId: ProviderId, variable: string): void {
  const state = readAuthState()
  const providerAuth = { ...(state.providers[providerId] ?? {}) }
  if (!providerAuth[variable]) {
    return
  }

  delete providerAuth[variable]

  const providers = { ...state.providers }
  if (Object.keys(providerAuth).length > 0) {
    providers[providerId] = providerAuth
  } else {
    delete providers[providerId]
  }

  writeAuthState({ providers })
}

export function deleteProviderCredentials(providerId: ProviderId, variables: string[]): void {
  variables.forEach((variable) => deleteProviderCredential(providerId, variable))
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
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8")
}

function normalizeProviderAuth(value: unknown): Record<string, Record<string, string>> {
  if (!isRecord(value)) {
    return {}
  }

  const providers: Record<string, Record<string, string>> = {}
  for (const [providerId, providerAuth] of Object.entries(value)) {
    if (!isRecord(providerAuth)) {
      continue
    }

    providers[providerId] = Object.fromEntries(
      Object.entries(providerAuth).filter((entry): entry is [string, string] => {
        const [key, encryptedValue] = entry
        return typeof key === "string" && typeof encryptedValue === "string"
      })
    )
  }

  return providers
}

function encryptValue(value: string): string {
  requireSafeStorage()
  return safeStorage.encryptString(value).toString("base64")
}

function decryptValue(value: string): string {
  requireSafeStorage()
  return safeStorage.decryptString(Buffer.from(value, "base64"))
}

function requireSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Jingle secure storage is not available on this system.")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
