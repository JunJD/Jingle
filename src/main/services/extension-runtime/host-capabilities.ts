import Store from "electron-store"
import { spawn } from "node:child_process"
import { dialog, shell } from "electron"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import type {
  ExtensionAiAskPayload,
  ExtensionRuntimeLaunchContext
} from "@shared/extension-runtime-protocol"
import type { ExtensionConfirmAlertPayload } from "@shared/extension-runtime-protocol"
import type { ExtensionToastPayload } from "@shared/extension-runtime-protocol"
import { getChatModelInstance } from "../../llm/get-chat-model"
import type { SettingsWindowRoutingService } from "../../settings-window-routing/service"
import type { ExternalLinksService } from "../../external-links/service"
import type { ExtensionQuicklinkService } from "../../extension-quicklinks/service"
import type { NativeExtensionsService } from "../../native-extensions/service"
import { getJingleHomeDir } from "../../storage"
import { readClipboardText, writeClipboardTextContent } from "../clipboard"
import {
  ExtensionRuntimeHostError,
  type ExtensionRuntimeHostCapabilities,
  type ExtensionRuntimeOpenExternalParams,
  type ExtensionRuntimeStorageScopeParams,
  type ExtensionRuntimeStorageParams
} from "./runtime-manager"
import type { ExtensionRuntimeRendererBridge } from "./renderer-bridge"
import {
  discardQuarantinedLegacyRuntimeStorageValue,
  encodeRuntimeStorageKey,
  migrateLegacyRuntimeStorageValues,
  readRuntimeStorageItemKey,
  type RuntimeStorageMigrationResult
} from "./storage-codec"

interface RuntimeStorageStoreShape {
  values: Record<string, unknown>
}

type OpenUrlWithApplication = (
  url: string,
  application: NonNullable<ExtensionRuntimeOpenExternalParams["application"]>
) => Promise<void>

const runtimeStorageStore = new Store<RuntimeStorageStoreShape>({
  cwd: getJingleHomeDir(),
  defaults: {
    values: {}
  },
  name: "extension-runtime-storage"
})

export class DefaultExtensionRuntimeHostCapabilities implements ExtensionRuntimeHostCapabilities {
  constructor(
    private readonly nativeExtensionsService: NativeExtensionsService,
    private readonly externalLinksService: ExternalLinksService,
    private readonly extensionQuicklinkService: ExtensionQuicklinkService,
    private readonly settingsWindowRoutingService: SettingsWindowRoutingService,
    private readonly rendererBridge: ExtensionRuntimeRendererBridge,
    private readonly openUrlWithApplication: OpenUrlWithApplication = openUrlWithDesktopApplication
  ) {}

  async askAI(input: ExtensionAiAskPayload): Promise<string> {
    const model = getChatModelInstance({
      modelPreference: input.modelPreference,
      modelId: input.modelId?.trim() || undefined,
      temperature: input.temperature,
      thinkingEffort: input.modelPreference === "fast" ? "off" : undefined
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

  async confirmAlert(alert: ExtensionConfirmAlertPayload): Promise<boolean> {
    const primaryAction = alert.primaryAction ?? {
      style: "destructive" as const,
      title: "Confirm"
    }
    const dismissAction = alert.dismissAction ?? {
      style: "cancel" as const,
      title: "Cancel"
    }
    const result = await dialog.showMessageBox({
      buttons: [primaryAction.title, dismissAction.title],
      cancelId: 1,
      defaultId: primaryAction.style === "destructive" ? 1 : 0,
      detail: alert.message,
      message: alert.title,
      noLink: true,
      type: primaryAction.style === "destructive" ? "warning" : "question"
    })

    return result.response === 0
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
    const prepared = prepareRuntimeStorageValues(params)
    const storageKey = getRuntimeStorageKey(params)
    if (Object.hasOwn(prepared.values, storageKey)) {
      return prepared.values[storageKey]
    }
    assertNoLegacyStorageConflict(
      params,
      prepared.quarantinedKeys.includes(params.key) ? [params.key] : []
    )
    return undefined
  }

  listStorageValues(params: ExtensionRuntimeStorageScopeParams): Record<string, unknown> {
    const prepared = prepareRuntimeStorageValues(params)
    const items = Object.fromEntries(
      Object.entries(prepared.values)
        .map(([key, value]) => [readRuntimeStorageStoreItemKey(key, params), value] as const)
        .filter((entry): entry is readonly [string, unknown] => entry[0] !== null)
    )
    assertNoLegacyStorageConflict(
      params,
      prepared.quarantinedKeys.filter((key) => !Object.hasOwn(items, key))
    )
    return items
  }

  removeStorageValue(params: ExtensionRuntimeStorageParams): void {
    const key = getRuntimeStorageKey(params)
    const prepared = prepareRuntimeStorageValues(params)
    const dataIdentity = requireRuntimeDataIdentity(params.context)
    const valuesWithoutLegacy = discardQuarantinedLegacyRuntimeStorageValue(
      prepared.values,
      {
        commandName: params.context.commandName,
        extensionName: params.context.extensionName,
        identity: dataIdentity.localStorage,
        scope: params.scope
      },
      params.key
    )
    const { [key]: _removed, ...nextValues } = valuesWithoutLegacy
    runtimeStorageStore.set("values", nextValues)
  }

  clearStorageValues(params: ExtensionRuntimeStorageScopeParams): void {
    const prepared = prepareRuntimeStorageValues(params, { discardBlockedLegacy: true })
    runtimeStorageStore.set(
      "values",
      Object.fromEntries(
        Object.entries(prepared.values).filter(
          ([key]) => readRuntimeStorageStoreItemKey(key, params) === null
        )
      )
    )
  }

  invokeNativeExtension(
    request: Parameters<NativeExtensionsService["invokeWithContext"]>[0],
    context: Parameters<NativeExtensionsService["invokeWithContext"]>[1]
  ): Promise<unknown> {
    return this.nativeExtensionsService.invokeWithContext(request, context)
  }

  openExtensionSettings(params: { commandName?: string; extensionName: string }): void {
    this.settingsWindowRoutingService.openWindow({
      tab: "extensions",
      target: params
    })
  }

  registerQuicklink(
    params: Parameters<ExtensionRuntimeHostCapabilities["registerQuicklink"]>[0]
  ): unknown {
    return this.extensionQuicklinkService.registerQuicklink({
      extensionName: params.request.extensionName ?? params.context.extensionName,
      link: params.request.link,
      name: params.request.name,
      shortcut: params.request.shortcut
    })
  }

  async openExternal(params: ExtensionRuntimeOpenExternalParams): Promise<void> {
    const scheme = readUrlScheme(params.url)
    if (!scheme || scheme === "http" || scheme === "https") {
      if (params.application) {
        await this.openUrlWithApplication(params.url, params.application)
        return
      }
      return this.externalLinksService.openExternal(params.url)
    }

    const manifest = this.nativeExtensionsService.getManifest(params.context.extensionName)
    const allowedManifestSchemes = new Set(
      (manifest.runtimeShell?.allowedUrlSchemes ?? []).map((entry) => entry.toLowerCase())
    )
    const requestedSchemes = new Set(params.allowedUrlSchemes.map((entry) => entry.toLowerCase()))
    if (!allowedManifestSchemes.has(scheme) || !requestedSchemes.has(scheme)) {
      throw new Error(
        `Native extension "${params.context.extensionName}" cannot open URL scheme "${scheme}"`
      )
    }

    if (params.application) {
      await this.openUrlWithApplication(params.url, params.application)
      return
    }

    await shell.openExternal(params.url)
  }

  showToast(params: { sessionId: string; toast: ExtensionToastPayload }): void {
    this.rendererBridge.showToast(params)
  }

  handleNavigationRequest(
    params: Parameters<ExtensionRuntimeRendererBridge["handleNavigationRequest"]>[0]
  ): Promise<void> {
    return this.rendererBridge.handleNavigationRequest(params)
  }

  handleRunBotAgentRequest(
    params: Parameters<ExtensionRuntimeRendererBridge["handleRunBotAgentRequest"]>[0]
  ): Promise<unknown> {
    return this.rendererBridge.handleRunBotAgentRequest(params)
  }

  setStorageValue(params: ExtensionRuntimeStorageParams & { value: unknown }): void {
    const prepared = prepareRuntimeStorageValues(params)
    runtimeStorageStore.set("values", {
      ...prepared.values,
      [getRuntimeStorageKey(params)]: params.value
    })
  }

  readClipboardText(): string {
    return readClipboardText()
  }

  readSelectedText(): string {
    return ""
  }

  pasteClipboardText(content: { html?: string; text: string }): void {
    writeClipboardTextContent(content)
  }

  writeClipboardText(content: { html?: string; text: string }): void {
    writeClipboardTextContent(content)
  }
}

function prepareRuntimeStorageValues(
  params: ExtensionRuntimeStorageScopeParams,
  options: { discardBlockedLegacy?: boolean } = {}
): RuntimeStorageMigrationResult {
  const dataIdentity = requireRuntimeDataIdentity(params.context)
  const currentValues = runtimeStorageStore.get("values", {})
  const migration = migrateLegacyRuntimeStorageValues(
    currentValues,
    {
      commandName: params.context.commandName,
      extensionName: params.context.extensionName,
      identity: dataIdentity.localStorage,
      scope: params.scope
    },
    options
  )
  if (migration.changed) {
    runtimeStorageStore.set("values", migration.values)
  }
  return migration
}

function assertNoLegacyStorageConflict(
  params: ExtensionRuntimeStorageScopeParams,
  quarantinedKeys: readonly string[]
): void {
  if (quarantinedKeys.length === 0) {
    return
  }

  const dataIdentity = requireRuntimeDataIdentity(params.context)
  const details = {
    keys: [...quarantinedKeys],
    kind: "storage-legacy-unowned" as const,
    scope: params.scope
  }
  const keys = quarantinedKeys.map((key) => JSON.stringify(key)).join(", ")
  const noun = quarantinedKeys.length === 1 ? "key" : "keys"
  const verb = quarantinedKeys.length === 1 ? "has" : "have"
  if (params.scope === "command") {
    throw new ExtensionRuntimeHostError(
      "storage_legacy_unowned",
      `Legacy command storage ${noun} ${keys} for extension "${params.context.extensionName}" ${verb} no owner for connection "${dataIdentity.localStorage.connectionId}". Update the stored value through the command component or hook that owns this key to establish the current typed owner.`,
      details
    )
  }

  const prefix = `Legacy LocalStorage ${noun} ${keys} for extension "${params.context.extensionName}" in the "${params.scope}" scope ${verb} no owner for connection "${dataIdentity.localStorage.connectionId}".`
  const recoveryCalls = quarantinedKeys
    .map((key) => `LocalStorage.setItem(${JSON.stringify(key)}, value)`)
    .join(", ")
  const discardCalls = quarantinedKeys
    .map((key) => `LocalStorage.removeItem(${JSON.stringify(key)})`)
    .join(", ")
  throw new ExtensionRuntimeHostError(
    "storage_legacy_unowned",
    `${prefix} Call ${recoveryCalls} to establish the current typed owner, ${discardCalls} to discard only the conflicting legacy data, or LocalStorage.clear() to discard all quarantined legacy data in this scope.`,
    details
  )
}

async function openUrlWithDesktopApplication(
  url: string,
  application: NonNullable<ExtensionRuntimeOpenExternalParams["application"]>
): Promise<void> {
  if (process.platform !== "darwin") {
    await shell.openExternal(url)
    return
  }

  const appSpecifier = application.bundleId
    ? ["-b", application.bundleId]
    : application.path
      ? ["-a", application.path]
      : application.name
        ? ["-a", application.name]
        : []
  if (appSpecifier.length === 0) {
    await shell.openExternal(url)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/open", [...appSpecifier, url], {
      detached: true,
      stdio: "ignore"
    })

    child.once("error", reject)
    child.once("spawn", () => resolve())
    child.unref()
  })
}

function getRuntimeStorageKey(params: ExtensionRuntimeStorageParams): string {
  const dataIdentity = requireRuntimeDataIdentity(params.context)
  return encodeRuntimeStorageKey({
    commandName: params.context.commandName,
    extensionName: params.context.extensionName,
    identity: dataIdentity.localStorage,
    key: params.key,
    scope: params.scope
  })
}

function readRuntimeStorageStoreItemKey(
  storageKey: string,
  params: ExtensionRuntimeStorageScopeParams
): string | null {
  const dataIdentity = requireRuntimeDataIdentity(params.context)
  return readRuntimeStorageItemKey(storageKey, {
    commandName: params.context.commandName,
    extensionName: params.context.extensionName,
    identity: dataIdentity.localStorage,
    scope: params.scope
  })
}

function requireRuntimeDataIdentity(
  context: ExtensionRuntimeLaunchContext
): Extract<ExtensionRuntimeLaunchContext["dataIdentity"], { kind: "available" }> {
  if (context.dataIdentity.kind !== "available") {
    throw new Error("Extension runtime storage requires an available data identity.")
  }
  return context.dataIdentity
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

function readUrlScheme(url: string): string | null {
  try {
    const protocol = new URL(url).protocol
    return protocol.endsWith(":") ? protocol.slice(0, -1).toLowerCase() : null
  } catch {
    return null
  }
}
