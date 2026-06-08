import { BrowserWindow } from "electron"
import type {
  NativeExtensionOAuthCallbackResult,
  NativeExtensionOAuthStartRequest,
  NativeExtensionOAuthStartResponse,
  NativeExtensionPackageManifest,
  NativeExtensionResolvedConnection,
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest,
  NativeExtensionPreferencesChangedEvent
} from "@shared/native-extensions"
import { listNativeExtensionManifests } from "@extensions/index"
import {
  getNativeExtensionCommandPreferenceRecord,
  getNativeExtensionPreferenceRecord,
  setNativeExtensionCommandPreferenceRecord,
  setNativeExtensionPreferenceRecord
} from "../preferences"
import {
  resolveNativeExtensionConnection,
  resolveNativeExtensionExecutionContext
} from "./connection-resolver"
import {
  invokeNativeExtension,
  listNativeExtensionSettingsSchemas
} from "../services/native-extensions"
import { NativeExtensionOAuthService } from "./oauth-service"

export class NativeExtensionsService {
  private readonly oauthService = new NativeExtensionOAuthService()

  getManifest(extensionName: string): NativeExtensionPackageManifest {
    const manifest = listNativeExtensionManifests(process.platform).find(
      (candidate) => candidate.name === extensionName
    )
    if (!manifest) {
      throw new Error(`Unknown native extension "${extensionName}"`)
    }

    return manifest
  }

  listSettingsSchemas(): InstalledNativeExtensionSettingsSchema[] {
    return listNativeExtensionSettingsSchemas()
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
