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
  getNativeExtensionPreferenceRecord,
  setNativeExtensionConnectionSecretRecord,
  setNativeExtensionCommandPreferenceRecord,
  setNativeExtensionPreferenceRecord,
  type NativeExtensionConfigurationMutation
} from "../preferences"
import { resolveNativeExtensionConnection } from "./connection-resolver"
import {
  resolveNativeExtensionExecutionContext,
  resolveNativeExtensionExecutionContextFromSnapshot,
  type NativeExtensionExecutionContextSnapshot
} from "./execution-context"
import {
  invokeNativeExtension,
  invokeNativeExtensionWithContext,
  listNativeExtensionLauncherCatalog,
  listNativeExtensionSettingsSchemas,
  listNativeExtensionSourceMentions
} from "../services/native-extensions"
import { getDefaultExtensionRegistryService } from "../extensions/registry/default-registry"
import { NativeExtensionOAuthService } from "./oauth-service"

export type NativeExtensionConfigurationCommittedListener = (
  mutation: NativeExtensionConfigurationMutation
) => void

export class NativeExtensionsService {
  private readonly configurationCommittedListeners =
    new Set<NativeExtensionConfigurationCommittedListener>()
  private readonly oauthService = new NativeExtensionOAuthService()

  onConfigurationCommitted(listener: NativeExtensionConfigurationCommittedListener): () => void {
    this.configurationCommittedListeners.add(listener)
    return () => {
      this.configurationCommittedListeners.delete(listener)
    }
  }

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
    const commit = setNativeExtensionPreferenceRecord(extensionName, nextRecord)
    this.emitConfigurationCommitted(commit.mutation)
    this.emitPreferencesChanged({
      extensionName,
      scope: "extension"
    })
    return commit.value
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
    const commit = setNativeExtensionCommandPreferenceRecord(extensionName, commandName, nextRecord)
    this.emitConfigurationCommitted(commit.mutation)
    this.emitPreferencesChanged({
      commandName,
      extensionName,
      scope: "command"
    })
    return commit.value
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

    const commit = setNativeExtensionConnectionSecretRecord({
      connectionId: connection.id,
      expectedConnection: connection,
      extensionName: request.extensionName,
      mode: "merge",
      nextRecord: request.secrets,
      provider: connection.provider
    })
    this.emitConfigurationCommitted(commit.mutation)
    this.emitPreferencesChanged({
      extensionName: request.extensionName,
      scope: "extension"
    })
    return resolveNativeExtensionExecutionContextFromSnapshot(commit.snapshot).connection
  }

  invoke(request: NativeExtensionInvokeRequest): Promise<unknown> {
    return invokeNativeExtension(request)
  }

  invokeWithContext(
    request: NativeExtensionInvokeRequest,
    context: NativeExtensionExecutionContextSnapshot
  ): Promise<unknown> {
    return invokeNativeExtensionWithContext(request, context)
  }

  async startOAuthConnection(
    request: NativeExtensionOAuthStartRequest
  ): Promise<NativeExtensionOAuthStartResponse> {
    return this.oauthService.startConnection(request)
  }

  async finishOAuthCallback(rawUrl: string): Promise<NativeExtensionOAuthCallbackResult> {
    const commit = await this.oauthService.finishCallback(rawUrl)
    this.emitConfigurationCommitted(commit.mutation)
    this.emitPreferencesChanged({
      extensionName: commit.result.extensionName,
      scope: "extension"
    })
    return commit.result
  }

  private emitConfigurationCommitted(mutation: NativeExtensionConfigurationMutation): void {
    for (const listener of this.configurationCommittedListeners) {
      try {
        listener(mutation)
      } catch (error) {
        // Admission must validate persisted revisions; observers only accelerate active-session cleanup.
        console.error("[jingle:native-extensions] Configuration commit listener failed", error)
      }
    }
  }

  private emitPreferencesChanged(event: NativeExtensionPreferencesChangedEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        try {
          window.webContents.send("nativeExtensions:preferencesChanged", event)
        } catch (error) {
          console.error("[jingle:native-extensions] Preference projection failed", error)
        }
      }
    }
  }
}
