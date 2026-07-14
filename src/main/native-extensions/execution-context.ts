import type {
  NativeExtensionConnectionManifest,
  NativeExtensionConnectionStatus,
  NativeExtensionExecutionContext,
  NativeExtensionResolvedConnection
} from "@shared/native-extensions"
import {
  getNativeExtensionConfigurationSnapshot,
  type NativeExtensionConfigurationSnapshot,
  type NativeExtensionConfigurationToken
} from "../preferences"

export interface NativeExtensionExecutionContextSnapshot extends NativeExtensionExecutionContext {
  configurationToken: NativeExtensionConfigurationToken
}

function isMissingConnectionSecret(value: unknown): boolean {
  return typeof value === "string"
    ? value.trim().length === 0
    : value === null || value === undefined
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
  commandPreferences?: Record<string, unknown>
  extensionPreferences: Record<string, unknown>
}): Record<string, unknown> | undefined {
  return input.commandPreferences
    ? {
        ...input.commandPreferences,
        ...input.extensionPreferences
      }
    : undefined
}

export function resolveNativeExtensionExecutionContextFromSnapshot(
  snapshot: NativeExtensionConfigurationSnapshot
): NativeExtensionExecutionContextSnapshot {
  const extensionPreferences = mergeConnectionPreferences({
    connection: snapshot.connection,
    connectionSecrets: snapshot.connectionSecrets,
    extensionPreferences: snapshot.extensionPreferences
  })
  const status = resolveConnectionStatus({
    connection: snapshot.connection,
    connectionSecrets: snapshot.connectionSecrets
  })
  const resolvedConnection: NativeExtensionResolvedConnection = {
    connectionId: snapshot.connection.id,
    extensionName: snapshot.extensionName,
    missingSecretNames: status.missingSecretNames,
    provider: snapshot.connection.provider,
    publicConfig: structuredClone(snapshot.publicConfig),
    status: status.status
  }
  const commandPreferences = resolveCommandPreferences({
    commandPreferences: snapshot.commandPreferences,
    extensionPreferences
  })

  return {
    ...(commandPreferences ? { commandPreferences } : {}),
    configurationToken: snapshot.token,
    connection: resolvedConnection,
    extensionName: snapshot.extensionName,
    extensionPreferences
  }
}

export function resolveNativeExtensionExecutionContext(input: {
  commandName?: string
  extensionName: string
  platform?: string
}): NativeExtensionExecutionContextSnapshot {
  const snapshot = getNativeExtensionConfigurationSnapshot(input)
  return resolveNativeExtensionExecutionContextFromSnapshot(snapshot)
}
