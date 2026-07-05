import assert from "node:assert/strict"
import test from "node:test"
import { isLauncherHeaderUsableModel } from "../../src/renderer/src/ai-core/launcher-model-filter"
import type { ModelConfig, Provider } from "../../src/shared/app-types"

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    fetchFrom: "predefined-model",
    id: "deepseek:deepseek-v4-pro",
    model: "deepseek-v4-pro",
    modelType: "llm",
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    status: "active",
    ...overrides
  }
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    configurateMethods: ["fetch-from-remote"],
    customConfiguration: {
      status: "active"
    },
    id: "deepseek",
    label: {
      en_US: "DeepSeek",
      zh_Hans: "DeepSeek"
    },
    modelListStatus: "active",
    name: "DeepSeek",
    providerCredentialSchema: {
      credentialFormSchemas: []
    },
    supportedModelTypes: ["llm"],
    systemConfiguration: {
      enabled: false
    },
    ...overrides
  }
}

test("launcher header model picker only exposes usable configured models", () => {
  assert.equal(isLauncherHeaderUsableModel(createModel(), createProvider()), true)
  assert.equal(
    isLauncherHeaderUsableModel(
      createModel({ provider: "anthropic" }),
      createProvider({
        customConfiguration: {
          status: "no-configure"
        },
        id: "anthropic",
        name: "Anthropic"
      })
    ),
    false
  )
  assert.equal(
    isLauncherHeaderUsableModel(createModel(), createProvider({ modelListStatus: "error" })),
    false
  )
  assert.equal(
    isLauncherHeaderUsableModel(createModel({ status: "no-configure" }), createProvider()),
    false
  )
})
