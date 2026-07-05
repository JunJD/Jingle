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
  connectionSecrets: Record<string, string>
  connection: NativeExtensionConnectionManifest
}): { missingSecretNames: string[]; status: NativeExtensionConnectionStatus } {
  if (input.connection.auth.type === "none") {
    return {
      missingSecretNames: [],
      status: "connected"
    }
  }

  const missingSecretNames = input.connection.auth.secretNames.filter((secretName) =>
    isMissingConnectionSecret(input.connectionSecrets[secretName])
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

function mergeConnectionPreferences(input: {
  connectionSecrets: Record<string, string>
  connection: NativeExtensionConnectionManifest
  extensionPreferences: Record<string, unknown>
}): Record<string, unknown> {
  const mergedPreferences = {
    ...input.connectionSecrets,
    ...input.extensionPreferences
  }

  if (input.connection.auth.type !== "none") {
    for (const secretName of input.connection.auth.secretNames) {
      if (!isMissingConnectionSecret(input.connectionSecrets[secretName])) {
        mergedPreferences[secretName] = input.connectionSecrets[secretName]
      }
    }
  }

  return mergedPreferences
}

function resolveCommandPreferences(input: {
  commandName?: string
  extensionName: string
  extensionPreferences: Record<string, unknown>
}): Record<string, unknown> | undefined {
  return input.commandName
    ? {
        ...getResolvedNativeExtensionCommandPreferenceRecord(
          input.extensionName,
          input.commandName
        ),
        ...input.extensionPreferences
      }
    : undefined
}

export function resolveNativeExtensionExecutionContext(input: {
  commandName?: string
  extensionName: string
  platform?: string
}): NativeExtensionExecutionContext {
  const manifest = getNativeExtensionManifest(input.extensionName, input.platform)
  const baseExtensionPreferences = getResolvedNativeExtensionPreferenceRecord(input.extensionName)
  const connection = manifest.connection
  const connectionSecrets =
    connection.auth.type === "none"
      ? {}
      : getNativeExtensionConnectionSecretRecord({
          connectionId: connection.id,
          provider: connection.provider,
          secretNames: connection.auth.secretNames
        })
  const extensionPreferences = mergeConnectionPreferences({
    connection,
    connectionSecrets,
    extensionPreferences: baseExtensionPreferences
  })
  const status = resolveConnectionStatus({
    connection,
    connectionSecrets
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
  const commandPreferences = resolveCommandPreferences({
    commandName: input.commandName,
    extensionName: input.extensionName,
    extensionPreferences
  })

  return {
    ...(commandPreferences ? { commandPreferences } : {}),
    connection: resolvedConnection,
    extensionName: input.extensionName,
    extensionPreferences
  }
}
