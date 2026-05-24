import { listNativeExtensionManifests } from "@extensions/index"
import type {
  NativeExtensionConnectionManifest,
  NativeExtensionConnectionStatus,
  NativeExtensionExecutionContext,
  NativeExtensionPackageManifest,
  NativeExtensionResolvedConnection
} from "@shared/native-extensions"
import {
  getResolvedNativeExtensionCommandPreferenceRecord,
  getResolvedNativeExtensionLegacyCommandScopedPasswordRecord,
  getResolvedNativeExtensionPreferenceRecord
} from "../preferences"

function isMissingConnectionSecret(value: unknown): boolean {
  return typeof value === "string"
    ? value.trim().length === 0
    : value === null || value === undefined
}

function getNativeExtensionManifest(extensionName: string, platform?: string) {
  const targetPlatform = platform ?? process.platform
  const manifest = listNativeExtensionManifests(targetPlatform).find(
    (candidate) => candidate.name === extensionName
  )
  if (!manifest) {
    throw new Error(`Unknown native extension "${extensionName}"`)
  }

  return manifest
}

function synthesizeConnectionManifest(
  manifest: NativeExtensionPackageManifest
): NativeExtensionConnectionManifest {
  const secretNames = manifest.aiCapability?.requiredPreferenceNames ?? []

  return {
    auth:
      secretNames.length > 0
        ? {
            secretNames,
            type: "apiKey"
          }
        : {
            type: "none"
          },
    id: "default",
    provider: manifest.name,
    publicPreferenceNames: manifest.aiCapability?.publicPreferenceNames,
    title: manifest.title
  }
}

function resolveConnectionStatus(input: {
  connection: NativeExtensionConnectionManifest
  extensionPreferences: Record<string, unknown>
}): { missingSecretNames: string[]; status: NativeExtensionConnectionStatus } {
  if (input.connection.auth.type === "none") {
    return {
      missingSecretNames: [],
      status: "connected"
    }
  }

  const missingSecretNames = input.connection.auth.secretNames.filter((secretName) =>
    isMissingConnectionSecret(input.extensionPreferences[secretName])
  )

  return {
    missingSecretNames,
    status: missingSecretNames.length > 0 ? "missing" : "connected"
  }
}

function resolvePublicConfig(input: {
  connection: NativeExtensionConnectionManifest
  extensionPreferences: Record<string, unknown>
}): Record<string, unknown> {
  return Object.fromEntries(
    (input.connection.publicPreferenceNames ?? []).flatMap((preferenceName) =>
      Object.prototype.hasOwnProperty.call(input.extensionPreferences, preferenceName)
        ? [[preferenceName, input.extensionPreferences[preferenceName]]]
        : []
    )
  )
}

function resolveLegacyCommandScopedSecrets(input: {
  connection: NativeExtensionConnectionManifest
  extensionName: string
  extensionPreferences: Record<string, unknown>
}): Record<string, string> {
  if (input.connection.auth.type === "none") {
    return {}
  }

  const missingSecretNames = input.connection.auth.secretNames.filter((secretName) =>
    isMissingConnectionSecret(input.extensionPreferences[secretName])
  )
  if (missingSecretNames.length === 0) {
    return {}
  }

  return getResolvedNativeExtensionLegacyCommandScopedPasswordRecord({
    extensionName: input.extensionName,
    passwordPreferenceNames: missingSecretNames
  })
}

export function resolveNativeExtensionExecutionContext(input: {
  commandName?: string
  extensionName: string
  platform?: string
}): NativeExtensionExecutionContext {
  const manifest = getNativeExtensionManifest(input.extensionName, input.platform)
  const connection = manifest.connection ?? synthesizeConnectionManifest(manifest)
  const baseExtensionPreferences = getResolvedNativeExtensionPreferenceRecord(input.extensionName)
  const extensionPreferences = {
    ...baseExtensionPreferences,
    ...resolveLegacyCommandScopedSecrets({
      connection,
      extensionName: input.extensionName,
      extensionPreferences: baseExtensionPreferences
    })
  }
  const status = resolveConnectionStatus({
    connection,
    extensionPreferences
  })
  const resolvedConnection: NativeExtensionResolvedConnection = {
    connectionId: connection.id,
    extensionName: input.extensionName,
    missingSecretNames: status.missingSecretNames,
    provider: connection.provider,
    publicConfig: resolvePublicConfig({
      connection,
      extensionPreferences
    }),
    status: status.status
  }
  const commandPreferences = input.commandName
    ? {
        ...getResolvedNativeExtensionCommandPreferenceRecord(input.extensionName, input.commandName),
        ...extensionPreferences
      }
    : undefined

  return {
    ...(commandPreferences ? { commandPreferences } : {}),
    connection: resolvedConnection,
    extensionName: input.extensionName,
    extensionPreferences
  }
}

export function resolveNativeExtensionConnection(input: {
  extensionName: string
  platform?: string
}): NativeExtensionResolvedConnection {
  return resolveNativeExtensionExecutionContext(input).connection
}
