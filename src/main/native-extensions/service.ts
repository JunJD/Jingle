import { BrowserWindow } from "electron"
import type {
  NativeExtensionOAuthCallbackResult,
  NativeExtensionConnectionSecretUpdateRequest,
  NativeExtensionOAuthStartRequest,
  NativeExtensionOAuthStartResponse,
  NativeExtensionLauncherCatalogProjection,
  NativeExtensionPackageManifest,
  NativeExtensionResolvedConnection,
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest,
  NativeExtensionPreferencesChangedEvent,
  NativeExtensionSourceMentionProjection
} from "@shared/native-extensions"
import {
  getNativeExtensionCommandPreferenceRecord,
  getNativeExtensionConnectionSecretRecord,
  getNativeExtensionPreferenceRecord,
  setNativeExtensionConnectionSecretRecord,
  setNativeExtensionCommandPreferenceRecord,
  setNativeExtensionPreferenceRecord
} from "../preferences"
import { resolveNativeExtensionConnection } from "./connection-resolver"
import { resolveNativeExtensionExecutionContext } from "./execution-context"
import {
  invokeNativeExtension,
  listNativeExtensionLauncherCatalog,
  listNativeExtensionSettingsSchemas,
  listNativeExtensionSourceMentions
} from "../services/native-extensions"
import { getDefaultExtensionRegistryService } from "../extensions/registry/default-registry"
import { NativeExtensionOAuthService } from "./oauth-service"

export class NativeExtensionsService {
  private readonly oauthService = new NativeExtensionOAuthService()

  getManifest(extensionName: string): NativeExtensionPackageManifest {
    const registry = getDefaultExtensionRegistryService()
    const extensionPackage = registry.getLoadedPackage(extensionName)
    if (
      !extensionPackage ||
      !registry
        .listEnabledPackages(process.platform)
        .some((candidate) => candidate.id === extensionName)
    ) {
      throw new Error(`Unknown native extension "${extensionName}"`)
    }

    return extensionPackage.manifest
  }

  listSettingsSchemas(): InstalledNativeExtensionSettingsSchema[] {
    return listNativeExtensionSettingsSchemas()
  }

  listLauncherCatalog(): NativeExtensionLauncherCatalogProjection[] {
    return listNativeExtensionLauncherCatalog()
  }

  listSourceMentions(): NativeExtensionSourceMentionProjection[] {
    return listNativeExtensionSourceMentions()
  }

  getPreferences(extensionName: string): Record<string, unknown> {
    return getNativeExtensionPreferenceRecord(extensionName)
  }

  getResolvedPreferences(extensionName: string): Record<string, unknown> {
    return resolveNativeExtensionExecutionContext({
      extensionName,
      platform: process.platform
    }).extensionPreferences
  }

  getConnection(extensionName: string): NativeExtensionResolvedConnection {
    return resolveNativeExtensionConnection({
      extensionName,
      platform: process.platform
    })
  }

  setPreferences(
    extensionName: string,
    nextRecord: Record<string, unknown>
  ): Record<string, unknown> {
    const record = setNativeExtensionPreferenceRecord(extensionName, nextRecord)
    this.emitPreferencesChanged({
      extensionName,
      scope: "extension"
    })
    return record
  }

  getCommandPreferences(extensionName: string, commandName: string): Record<string, unknown> {
    return getNativeExtensionCommandPreferenceRecord(extensionName, commandName)
  }

  getResolvedCommandPreferences(
    extensionName: string,
    commandName: string
  ): Record<string, unknown> {
    const context = resolveNativeExtensionExecutionContext({
      commandName,
      extensionName,
      platform: process.platform
    })

    return context.commandPreferences ?? context.extensionPreferences
  }

  setCommandPreferences(params: {
    commandName: string
    extensionName: string
    nextRecord: Record<string, unknown>
  }): Record<string, unknown> {
    const { commandName, extensionName, nextRecord } = params
    const record = setNativeExtensionCommandPreferenceRecord(extensionName, commandName, nextRecord)
    this.emitPreferencesChanged({
      commandName,
      extensionName,
      scope: "command"
    })
    return record
  }

  setConnectionSecrets(
    request: NativeExtensionConnectionSecretUpdateRequest
  ): NativeExtensionResolvedConnection {
    const manifest = this.getManifest(request.extensionName)
    const connection = manifest.connection
    if (!connection) {
      throw new Error(`Native extension "${request.extensionName}" does not declare a connection`)
    }
    if (request.connectionId && connection.id !== request.connectionId) {
      throw new Error(
        `Native extension "${request.extensionName}" does not declare connection "${request.connectionId}"`
      )
    }
    if (connection.auth.type === "none") {
      throw new Error(
        `Native extension "${request.extensionName}" connection "${connection.id}" does not use secrets`
      )
    }
    if (connection.auth.type === "oauth") {
      throw new Error(
        `Native extension "${request.extensionName}" connection "${connection.id}" is OAuth-backed`
      )
    }

    const currentRecord = getNativeExtensionConnectionSecretRecord({
      connectionId: connection.id,
      provider: connection.provider,
      secretNames: connection.auth.secretNames
    })
    setNativeExtensionConnectionSecretRecord({
      connectionId: connection.id,
      nextRecord: {
        ...currentRecord,
        ...request.secrets
      },
      provider: connection.provider,
      secretNames: connection.auth.secretNames
    })
    this.emitPreferencesChanged({
      extensionName: request.extensionName,
      scope: "extension"
    })
    return this.getConnection(request.extensionName)
  }

  invoke(request: NativeExtensionInvokeRequest): Promise<unknown> {
    return invokeNativeExtension(request)
  }

  async startOAuthConnection(
    request: NativeExtensionOAuthStartRequest
  ): Promise<NativeExtensionOAuthStartResponse> {
    return this.oauthService.startConnection(request)
  }

  async finishOAuthCallback(rawUrl: string): Promise<NativeExtensionOAuthCallbackResult> {
    const result = await this.oauthService.finishCallback(rawUrl)
    this.emitPreferencesChanged({
      extensionName: result.extensionName,
      scope: "extension"
    })
    return result
  }

  private emitPreferencesChanged(event: NativeExtensionPreferencesChangedEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("nativeExtensions:preferencesChanged", event)
      }
    }
  }
}
