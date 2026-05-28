import type {
  ExtensionAiAskPayload,
  ExtensionConfirmAlertPayload,
  ExtensionNavigationHostRequest,
  ExtensionRuntimeHostCapability,
  ExtensionToastPayload
} from "@shared/extension-runtime-protocol"
import type {
  NativeExtensionInvokeContext,
  NativeExtensionInvokeRequest
} from "@shared/native-extensions"
import type {
  ExtensionRuntimeHostCapabilities,
  ExtensionRuntimeStorageParams
} from "./runtime-manager"

interface ExtensionRuntimeBddProbe {
  askAI?: (input: ExtensionAiAskPayload) => Promise<string> | string
  lastAiAsk?: ExtensionAiAskPayload
  hostRequests: Array<{ capability: ExtensionRuntimeHostCapability; payload: unknown }>
  invokeNativeExtension?: (
    request: NativeExtensionInvokeRequest,
    context: NativeExtensionInvokeContext
  ) => Promise<unknown> | unknown
  rpcCalls: Array<{ extensionName: string; method: string; payload: unknown }>
}

interface ExtensionRuntimeBddFixtures {
  aiResponseText?: string
  appleRemindersData?: unknown
  githubNotification?: unknown
}

export function wrapExtensionRuntimeHostForBdd(
  host: ExtensionRuntimeHostCapabilities
): ExtensionRuntimeHostCapabilities {
  const probe = getExtensionRuntimeBddProbe()
  if (!probe) {
    return host
  }

  return new BddExtensionRuntimeHostCapabilities(host, probe)
}

class BddExtensionRuntimeHostCapabilities implements ExtensionRuntimeHostCapabilities {
  constructor(
    private readonly host: ExtensionRuntimeHostCapabilities,
    private readonly probe: ExtensionRuntimeBddProbe
  ) {}

  askAI(input: ExtensionAiAskPayload): Promise<string> {
    this.record("ai", input)
    if (this.probe.askAI) {
      return Promise.resolve(this.probe.askAI(input))
    }

    return this.host.askAI(input)
  }

  confirmAlert(
    alert: ExtensionConfirmAlertPayload
  ): ReturnType<ExtensionRuntimeHostCapabilities["confirmAlert"]> {
    this.record("dialog", alert)
    return this.host.confirmAlert(alert)
  }

  getRuntimeCapabilities(
    params: Parameters<ExtensionRuntimeHostCapabilities["getRuntimeCapabilities"]>[0]
  ): ReturnType<ExtensionRuntimeHostCapabilities["getRuntimeCapabilities"]> {
    return this.host.getRuntimeCapabilities(params)
  }

  getCommandPreferences(
    params: Parameters<ExtensionRuntimeHostCapabilities["getCommandPreferences"]>[0]
  ): ReturnType<ExtensionRuntimeHostCapabilities["getCommandPreferences"]> {
    return this.host.getCommandPreferences(params)
  }

  getExtensionPreferences(
    extensionName: string
  ): ReturnType<ExtensionRuntimeHostCapabilities["getExtensionPreferences"]> {
    return this.host.getExtensionPreferences(extensionName)
  }

  getStorageValue(
    params: ExtensionRuntimeStorageParams
  ): ReturnType<ExtensionRuntimeHostCapabilities["getStorageValue"]> {
    return this.host.getStorageValue(params)
  }

  listStorageValues(
    params: Parameters<ExtensionRuntimeHostCapabilities["listStorageValues"]>[0]
  ): ReturnType<ExtensionRuntimeHostCapabilities["listStorageValues"]> {
    return this.host.listStorageValues(params)
  }

  removeStorageValue(
    params: ExtensionRuntimeStorageParams
  ): ReturnType<ExtensionRuntimeHostCapabilities["removeStorageValue"]> {
    return this.host.removeStorageValue(params)
  }

  clearStorageValues(
    params: Parameters<ExtensionRuntimeHostCapabilities["clearStorageValues"]>[0]
  ): ReturnType<ExtensionRuntimeHostCapabilities["clearStorageValues"]> {
    return this.host.clearStorageValues(params)
  }

  handleNavigationRequest(params: {
    request: ExtensionNavigationHostRequest
    sessionId: string
  }): ReturnType<ExtensionRuntimeHostCapabilities["handleNavigationRequest"]> {
    this.record("navigation", params.request)
    return this.host.handleNavigationRequest(params)
  }

  async invokeNativeExtension(request: NativeExtensionInvokeRequest): Promise<unknown> {
    this.record("rpc", request)
    if (this.probe.invokeNativeExtension) {
      const extensionPreferences = await this.host.getExtensionPreferences(request.extensionName)
      return this.probe.invokeNativeExtension(request, {
        extensionPreferences
      })
    }

    return this.host.invokeNativeExtension(request)
  }

  openExtensionSettings(
    params: Parameters<ExtensionRuntimeHostCapabilities["openExtensionSettings"]>[0]
  ): ReturnType<ExtensionRuntimeHostCapabilities["openExtensionSettings"]> {
    this.record("settings", params)
    return this.host.openExtensionSettings(params)
  }

  registerQuicklink(
    params: Parameters<ExtensionRuntimeHostCapabilities["registerQuicklink"]>[0]
  ): ReturnType<ExtensionRuntimeHostCapabilities["registerQuicklink"]> {
    this.record("quicklinks", params.request)
    return this.host.registerQuicklink(params)
  }

  openExternal(
    params: Parameters<ExtensionRuntimeHostCapabilities["openExternal"]>[0]
  ): Promise<void> {
    this.record("shell", {
      allowedUrlSchemes: params.allowedUrlSchemes,
      application: params.application,
      url: params.url
    })
    return this.host.openExternal(params)
  }

  showToast(
    toast: ExtensionToastPayload
  ): ReturnType<ExtensionRuntimeHostCapabilities["showToast"]> {
    this.record("toast", toast)
    return this.host.showToast(toast)
  }

  setStorageValue(
    params: ExtensionRuntimeStorageParams & { value: unknown }
  ): ReturnType<ExtensionRuntimeHostCapabilities["setStorageValue"]> {
    return this.host.setStorageValue(params)
  }

  readClipboardText(): ReturnType<ExtensionRuntimeHostCapabilities["readClipboardText"]> {
    this.record("clipboard", { method: "read-text" })
    return this.host.readClipboardText()
  }

  readSelectedText(): ReturnType<ExtensionRuntimeHostCapabilities["readSelectedText"]> {
    this.record("clipboard", { method: "read-selected-text" })
    return this.host.readSelectedText()
  }

  pasteClipboardText(
    text: string
  ): ReturnType<ExtensionRuntimeHostCapabilities["pasteClipboardText"]> {
    this.record("clipboard", { method: "paste-text", text })
    return this.host.pasteClipboardText(text)
  }

  writeClipboardText(
    text: string
  ): ReturnType<ExtensionRuntimeHostCapabilities["writeClipboardText"]> {
    this.record("clipboard", { method: "write-text", text })
    return this.host.writeClipboardText(text)
  }

  private record(capability: ExtensionRuntimeHostCapability, payload: unknown): void {
    this.probe.hostRequests.push({ capability, payload })
  }
}

function getExtensionRuntimeBddProbe(): ExtensionRuntimeBddProbe | null {
  if (process.env.OPENWORK_BDD !== "1") {
    return null
  }

  const state = globalThis as typeof globalThis & {
    __OPENWORK_BDD_EXTENSION_RUNTIME__?: ExtensionRuntimeBddProbe
  }

  state.__OPENWORK_BDD_EXTENSION_RUNTIME__ ??= createExtensionRuntimeBddProbe()
  return state.__OPENWORK_BDD_EXTENSION_RUNTIME__ ?? null
}

function createExtensionRuntimeBddProbe(): ExtensionRuntimeBddProbe | undefined {
  const fixtures = parseExtensionRuntimeBddFixtures()
  if (!fixtures) {
    return undefined
  }

  const probe: ExtensionRuntimeBddProbe = {
    hostRequests: [],
    rpcCalls: []
  }

  if (fixtures.aiResponseText) {
    probe.askAI = (input) => {
      probe.lastAiAsk = input
      return fixtures.aiResponseText!
    }
  }

  if (fixtures.appleRemindersData || fixtures.githubNotification) {
    probe.invokeNativeExtension = (request) => {
      probe.rpcCalls.push({
        extensionName: request.extensionName,
        method: request.method,
        payload: request.payload
      })

      if (request.extensionName === "apple-reminders") {
        if (request.method === "get-data") {
          return fixtures.appleRemindersData
        }

        if (request.method === "show-reminder") {
          return null
        }
      }

      if (request.extensionName === "github") {
        if (request.method === "list-unread-notifications") {
          return {
            configured: true,
            notifications: fixtures.githubNotification ? [fixtures.githubNotification] : []
          }
        }

        if (
          request.method === "mark-notification-as-read" ||
          request.method === "mark-all-notifications-as-read"
        ) {
          return null
        }
      }

      throw new Error(
        `BDD extension runtime RPC fixture missing ${request.extensionName}:${request.method}`
      )
    }
  }

  return probe
}

function parseExtensionRuntimeBddFixtures(): ExtensionRuntimeBddFixtures | undefined {
  const raw = process.env.OPENWORK_BDD_EXTENSION_RUNTIME_FIXTURES
  if (!raw) {
    return undefined
  }

  return JSON.parse(raw) as ExtensionRuntimeBddFixtures
}
