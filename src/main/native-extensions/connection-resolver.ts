import type {
  NativeExtensionConnectionManifest,
  NativeExtensionConnectionStatus,
  NativeExtensionExecutionContext,
  NativeExtensionResolvedConnection
} from "@shared/native-extensions"
import { getDefaultExtensionRegistryService } from "../extensions/registry/default-registry"
import {
  getNativeExtensionConnectionSecretRecord,
  getResolvedNativeExtensionCommandPreferenceRecord,
  getResolvedNativeExtensionPreferenceRecord
} from "../preferences"

function isMissingConnectionSecret(value: unknown): boolean {
  return typeof value === "string"
    ? value.trim().length === 0
    : value === null || value === undefined
}

function getNativeExtensionManifest(extensionName: string, platform?: string) {
  const targetPlatform = platform ?? process.platform
  const manifest = getDefaultExtensionRegistryService().listManifests(targetPlatform).find(
    (candidate) => candidate.name === extensionName
  )
  if (!manifest) {
    throw new Error(`Unknown native extension "${extensionName}"`)
  }

  return manifest
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

function resolveProviderExtensionPreferences(input: {
  connection: NativeExtensionConnectionManifest
  extensionName: string
  platform?: string
}): Record<string, unknown> {
  if (input.connection.provider === input.extensionName) {
    return {}
  }

  const providerManifest = getDefaultExtensionRegistryService()
    .listManifests(input.platform ?? process.platform)
    .find((manifest) => manifest.name === input.connection.provider)
  if (!providerManifest) {
    return {}
  }

  const providerConnection = providerManifest.connection
  if (!providerConnection) {
    throw new Error(`Native extension "${providerManifest.name}" is missing connection manifest`)
  }
  if (providerConnection.provider !== input.connection.provider) {
    return {}
  }

  const providerPreferences = getResolvedNativeExtensionPreferenceRecord(providerManifest.name)
  const preferenceNames = new Set([
    ...(input.connection.publicPreferenceNames ?? []),
    ...(input.connection.auth.type === "none" ? [] : input.connection.auth.secretNames)
  ])

  return Object.fromEntries(
    Array.from(preferenceNames).flatMap((preferenceName) =>
      Object.prototype.hasOwnProperty.call(providerPreferences, preferenceName)
        ? [[preferenceName, providerPreferences[preferenceName]]]
        : []
    )
  )
}

function mergeProviderConnectionPreferences(input: {
  connectionSecrets: Record<string, string>
  connection: NativeExtensionConnectionManifest
  extensionPreferences: Record<string, unknown>
  providerPreferences: Record<string, unknown>
}): Record<string, unknown> {
  const mergedPreferences = {
    ...input.connectionSecrets,
    ...input.providerPreferences,
    ...input.extensionPreferences
  }

  if (input.connection.auth.type === "none") {
    return mergedPreferences
  }

  for (const secretName of input.connection.auth.secretNames) {
    if (!isMissingConnectionSecret(input.connectionSecrets[secretName])) {
      mergedPreferences[secretName] = input.connectionSecrets[secretName]
    } else if (
      isMissingConnectionSecret(input.extensionPreferences[secretName]) &&
      !isMissingConnectionSecret(input.providerPreferences[secretName])
    ) {
      mergedPreferences[secretName] = input.providerPreferences[secretName]
    }
  }

  return mergedPreferences
}

export function resolveNativeExtensionExecutionContext(input: {
  commandName?: string
  extensionName: string
  platform?: string
}): NativeExtensionExecutionContext {
  const manifest = getNativeExtensionManifest(input.extensionName, input.platform)
  const connection = manifest.connection
  if (!connection) {
    throw new Error(`Native extension "${input.extensionName}" is missing connection manifest`)
  }
  const baseExtensionPreferences = getResolvedNativeExtensionPreferenceRecord(input.extensionName)
  const providerPreferences = resolveProviderExtensionPreferences({
    connection,
    extensionName: input.extensionName,
    platform: input.platform
  })
  const connectionSecrets =
    connection.auth.type === "none"
      ? {}
      : getNativeExtensionConnectionSecretRecord({
          connectionId: connection.id,
          provider: connection.provider,
          secretNames: connection.auth.secretNames
        })
  const extensionPreferences = mergeProviderConnectionPreferences({
    connection,
    connectionSecrets,
    extensionPreferences: baseExtensionPreferences,
    providerPreferences
  })
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
        ...getResolvedNativeExtensionCommandPreferenceRecord(
          input.extensionName,
          input.commandName
        ),
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
