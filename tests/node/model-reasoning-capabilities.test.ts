import assert from "node:assert/strict"
import test from "node:test"
import {
  assertReasoningEffortSupported,
  createCustomReasoningEffortCapability,
  REASONING_CAPABILITY_REGISTRY_VERSION,
  resolveModelReasoningEffortCapability
} from "../../src/main/model-provider/reasoning-capabilities"
import type { CustomProviderConfig, ModelConfig } from "../../src/main/model-provider/types"
import { projectReasoningEffortSelection } from "../../src/renderer/src/features/model-provider/model-setup/model-setup-projection"

function model(provider: string, modelName: string): ModelConfig {
  return {
    fetchFrom: "fetch-from-remote",
    id: `${provider}:${modelName}`,
    model: modelName,
    modelType: "llm",
    name: modelName,
    provider,
    reasoning: true,
    status: "active"
  }
}

test("versioned registry resolves exact OpenAI, xAI, and DeepSeek model ids", () => {
  const openai = resolveModelReasoningEffortCapability({ model: model("openai", "gpt-5.6") })
  assert.equal(openai.capability?.version, REASONING_CAPABILITY_REGISTRY_VERSION)
  assert.deepEqual(openai.capability?.allowedValues, [
    "off",
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ])

  const xai = resolveModelReasoningEffortCapability({
    model: model("vercel_ai_gateway", "xai/grok-4.20-multi-agent")
  })
  assert.deepEqual(xai.capability?.allowedValues, ["low", "medium", "high", "xhigh"])

  const deepseek = resolveModelReasoningEffortCapability({
    model: model("deepseek", "deepseek-v4-pro")
  })
  assert.deepEqual(deepseek.capability?.allowedValues, ["off", "high", "max"])
})

test("registry does not infer capabilities from similar or remote model names", () => {
  const unknownOpenAI = resolveModelReasoningEffortCapability({
    model: model("openai", "gpt-5.6-unknown-snapshot")
  })
  const unknownCompatible = resolveModelReasoningEffortCapability({
    model: model("custom_proxy", "gpt-5.6")
  })

  assert.equal(unknownOpenAI.capability, null)
  assert.equal(unknownCompatible.capability, null)
  assert.throws(
    () =>
      assertReasoningEffortSupported({
        capability: unknownCompatible,
        effort: "max",
        modelId: "custom_proxy:gpt-5.6"
      }),
    /Open model settings and choose a supported value/
  )
})

test("GPT-5 does not inherit GPT-5.1 none support", () => {
  const gpt5 = resolveModelReasoningEffortCapability({ model: model("openai", "gpt-5") })
  assert.throws(
    () =>
      assertReasoningEffortSupported({
        capability: gpt5,
        effort: "off",
        modelId: "openai:gpt-5"
      }),
    /Thinking effort "off" is not supported/
  )
})

test("typed custom declarations use the single capability owner", () => {
  const declaredModel: CustomProviderConfig["models"][number] = {
    name: "vendor-reasoner",
    reasoning_efforts: ["low", "high"]
  }
  const customProvider = {
    display_name: "Proxy",
    engine: "openai",
    models: [declaredModel],
    name: "custom_proxy"
  } as CustomProviderConfig
  const capability = createCustomReasoningEffortCapability({
    model: declaredModel,
    provider: customProvider
  })
  const resolved = resolveModelReasoningEffortCapability({
    customProvider,
    model: {
      ...model("custom_proxy", "vendor-reasoner"),
      reasoningEffortCapability: capability
    }
  })

  assert.deepEqual(resolved.capability?.allowedValues, ["low", "high"])
  assert.equal(resolved.transport, "openai-compatible")
  assert.throws(
    () =>
      createCustomReasoningEffortCapability({
        model: declaredModel,
        provider: { ...customProvider, engine: "anthropic" }
      }),
    /is not OpenAI-compatible/
  )
})

test("custom authorization ignores forged or stale ModelConfig capability projections", () => {
  const canonicalProvider = {
    display_name: "Proxy",
    engine: "openai",
    models: [{ name: "vendor-reasoner", reasoning_efforts: ["low"] }],
    name: "custom_proxy"
  } as CustomProviderConfig
  const forgedModel: ModelConfig = {
    ...model("custom_proxy", "vendor-reasoner"),
    reasoningEffortCapability: {
      allowedValues: ["max"],
      source: "custom-declaration" as const,
      version: "forged"
    }
  }
  const resolved = resolveModelReasoningEffortCapability({
    customProvider: canonicalProvider,
    model: forgedModel
  })
  assert.deepEqual(resolved.capability?.allowedValues, ["low"])
  assert.throws(
    () =>
      assertReasoningEffortSupported({
        capability: resolved,
        effort: "max",
        modelId: "custom_proxy:vendor-reasoner"
      }),
    /Thinking effort "max" is not supported/
  )

  const stale = resolveModelReasoningEffortCapability({
    customProvider: { ...canonicalProvider, models: [] },
    model: forgedModel
  })
  assert.equal(stale.capability, null)

  const ambiguous = resolveModelReasoningEffortCapability({
    customProvider: {
      ...canonicalProvider,
      models: [canonicalProvider.models[0], canonicalProvider.models[0]]
    },
    model: forgedModel
  })
  assert.equal(ambiguous.capability, null)
})

test("Google legacy values bypass the new registry without advertising UI capability", () => {
  const google = resolveModelReasoningEffortCapability({ model: model("google", "gemini-3-pro") })
  assert.equal(google.capability, null)
  assert.equal(google.transport, "google-existing")
  assert.doesNotThrow(() =>
    assertReasoningEffortSupported({
      capability: google,
      effort: "high",
      modelId: "google:gemini-3-pro"
    })
  )
  assert.throws(
    () =>
      assertReasoningEffortSupported({
        capability: google,
        effort: "xhigh",
        modelId: "google:gemini-3-pro"
      }),
    /Thinking effort "xhigh" is not supported/
  )
})

test("UI projection exposes only the model intersection and keeps invalid legacy values visible", () => {
  assert.deepEqual(
    projectReasoningEffortSelection({
      allowedValues: ["low", "high"],
      selectedValue: "max"
    }),
    {
      allowedValues: ["low", "high"],
      invalidSelectedValue: "max"
    }
  )
  assert.deepEqual(projectReasoningEffortSelection({ allowedValues: [], selectedValue: null }), {
    allowedValues: [],
    invalidSelectedValue: null
  })
})
