import Store from "electron-store"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import type { ExtensionRuntimeHostCapability } from "@shared/extension-runtime-protocol"
import type { ExtensionAiAskPayload } from "@shared/extension-runtime-protocol"
import { getChatModelInstance } from "../../llm/get-chat-model"
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

  getRuntimeCapabilities(params: {
    commandName: string
    extensionName: string
  }): readonly ExtensionRuntimeHostCapability[] {
    const manifest = this.nativeExtensionsService.getManifest(params.extensionName)
    if (!manifest.commands.some((command) => command.name === params.commandName)) {
      throw new Error(
        `Native extension "${params.extensionName}" does not declare command "${params.commandName}"`
      )
    }

    return manifest.runtimeCapabilities ?? []
  }

  async askAI(input: ExtensionAiAskPayload): Promise<string> {
    const model = getChatModelInstance({
      modelPreference: input.modelPreference,
      modelId: input.modelId?.trim() || undefined,
      temperature: input.temperature
    })
    const messages = input.system
      ? [new SystemMessage(input.system), new HumanMessage(input.prompt)]
      : [new HumanMessage(input.prompt)]
    const response = await model.invoke(messages)
    const text = extractTextContent(response.content).trim()

    if (!text) {
      throw new Error("AI request returned empty output")
    }

    return text
  }

  getCommandPreferences(params: {
    commandName: string
    extensionName: string
  }): Record<string, unknown> {
    return this.nativeExtensionsService.getResolvedCommandPreferences(
      params.extensionName,
      params.commandName
    )
  }

  getExtensionPreferences(extensionName: string): Record<string, unknown> {
    return this.nativeExtensionsService.getResolvedPreferences(extensionName)
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

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item
        }

        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text
        }

        return ""
      })
      .join("")
  }

  return ""
}
