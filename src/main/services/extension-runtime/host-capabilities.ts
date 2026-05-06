import Store from "electron-store"
import type { SettingsWindowRoutingService } from "../../settings-window-routing/service"
import type { ExternalLinksService } from "../../external-links/service"
import type { NativeExtensionsService } from "../../native-extensions/service"
import { getOpenworkDir } from "../../storage"
import { writeClipboardText } from "../clipboard"
import type {
  ExtensionRuntimeHostCapabilities,
  ExtensionRuntimeStorageParams
} from "./runtime-manager"
import type { ExtensionRuntimeRendererBridge } from "./renderer-bridge"

interface RuntimeStorageStoreShape {
  values: Record<string, unknown>
}

const runtimeStorageStore = new Store<RuntimeStorageStoreShape>({
  cwd: getOpenworkDir(),
  defaults: {
    values: {}
  },
  name: "extension-runtime-storage"
})

export class DefaultExtensionRuntimeHostCapabilities implements ExtensionRuntimeHostCapabilities {
  constructor(
    private readonly nativeExtensionsService: NativeExtensionsService,
    private readonly externalLinksService: ExternalLinksService,
    private readonly settingsWindowRoutingService: SettingsWindowRoutingService,
    private readonly rendererBridge: ExtensionRuntimeRendererBridge
  ) {}

  getCommandPreferences(params: {
    commandName: string
    extensionName: string
  }): Record<string, unknown> {
    return this.nativeExtensionsService.getCommandPreferences(
      params.extensionName,
      params.commandName
    )
  }

  getExtensionPreferences(extensionName: string): Record<string, unknown> {
    return this.nativeExtensionsService.getPreferences(extensionName)
  }

  getStorageValue(params: ExtensionRuntimeStorageParams): unknown {
    return runtimeStorageStore.get("values", {})[getRuntimeStorageKey(params)]
  }

  invokeNativeExtension(
    request: Parameters<NativeExtensionsService["invoke"]>[0]
  ): Promise<unknown> {
    return this.nativeExtensionsService.invoke(request)
  }

  openExtensionSettings(params: { commandName?: string; extensionName: string }): void {
    this.settingsWindowRoutingService.openWindow({
      tab: "extensions",
      target: params
    })
  }

  openExternal(url: string): Promise<void> {
    return this.externalLinksService.openExternal(url)
  }

  handleNavigationRequest(
    params: Parameters<ExtensionRuntimeRendererBridge["handleNavigationRequest"]>[0]
  ): Promise<void> {
    return this.rendererBridge.handleNavigationRequest(params)
  }

  setStorageValue(params: ExtensionRuntimeStorageParams & { value: unknown }): void {
    runtimeStorageStore.set("values", {
      ...runtimeStorageStore.get("values", {}),
      [getRuntimeStorageKey(params)]: params.value
    })
  }

  writeClipboardText(text: string): void {
    writeClipboardText(text)
  }
}

function getRuntimeStorageKey(params: ExtensionRuntimeStorageParams): string {
  return JSON.stringify([params.context.extensionName, params.context.commandName, params.key])
}
