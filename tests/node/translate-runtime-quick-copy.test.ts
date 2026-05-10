import assert from "node:assert/strict"
import test from "node:test"
import {
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "../../src/extension-runtime/sdk"
import { getNativeExtensionRuntimeCommand } from "../../src/extensions/runtime"
import { translateManifest } from "../../src/extensions/translate/manifest"
import TranslateQuickCopy from "../../src/extensions/translate/src/translate-quick-copy"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("Translate commands resolve through runtime", () => {
  assert.deepEqual(
    translateManifest.commands
      .filter((command) => command.runtime)
      .map((command) => command.name),
    ["translate", "translate-quick-copy"]
  )
  assert.ok(translateManifest.capabilities.includes("clipboard"))
  assert.equal(
    getNativeExtensionRuntimeCommand({
      commandName: "translate",
      extensionName: "translate"
    })?.mode,
    "view"
  )
  assert.equal(
    getNativeExtensionRuntimeCommand({
      commandName: "translate-quick-copy",
      extensionName: "translate"
    })?.mode,
    "no-view"
  )
})

test("Translate runtime quick-copy translates, writes clipboard, and returns home", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const seedQuery = "translate hello to Chinese"
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests)
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(seedQuery),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests)
    },
    () =>
      TranslateQuickCopy({
        commandPreferences: {
          modelId: "openai:gpt-test"
        },
        navigation,
        seedQuery
      })
  )

  assert.deepEqual(requests, [
    {
      capability: "rpc",
      method: "invoke-native-extension",
      payload: {
        extensionName: "translate",
        method: "translate",
        payload: {
          backend: {
            kind: "llm",
            modelId: "openai:gpt-test"
          },
          sourceLanguage: "English",
          targetLanguage: "Simplified Chinese",
          text: "hello"
        }
      }
    },
    {
      capability: "clipboard",
      method: "write-text",
      payload: {
        text: "你好"
      }
    },
    {
      capability: "navigation",
      method: "go-home"
    }
  ])
})

function createLaunchContext(seedQuery: string): ExtensionRuntimeLaunchContext {
  return {
    commandName: "translate-quick-copy",
    commandPreferences: {
      modelId: "openai:gpt-test"
    },
    extensionName: "translate",
    extensionPreferences: {},
    initialAction: "submit",
    locale: "zh-CN",
    mode: "no-view",
    seedQuery
  }
}

function resolveRuntimeRequest(
  request: ExtensionRuntimeHostRequestInput,
  requests: ExtensionRuntimeHostRequestInput[]
): ExtensionHostResponse {
  requests.push(request)

  if (request.capability === "rpc") {
    return createHostResponse({
      backend: {
        kind: "llm",
        modelId: "openai:gpt-test"
      },
      modelId: "openai:gpt-test",
      sourceLanguage: "English",
      targetLanguage: "Simplified Chinese",
      translatedText: "你好"
    })
  }

  return createHostResponse(null)
}

function createHostResponse(result: unknown): ExtensionHostResponse {
  return {
    id: "test-host-request",
    ok: true,
    result
  }
}
