import assert from "node:assert/strict"
import test from "node:test"
import {
  assertReasoningEffortSupported,
  createCustomReasoningEffortCapability,
  CUSTOM_REASONING_EFFORT_DECLARATION_VERSION,
  REASONING_CAPABILITY_REGISTRY_VERSION,
  resolveModelReasoningEffortCapability
} from "../../src/main/model-provider/reasoning-capabilities"
import type { CustomProviderConfig, ModelConfig } from "../../src/main/model-provider/types"
import {
  projectCustomProviderModelInputs,
  projectReasoningEffortSelection
} from "../../src/renderer/src/features/model-provider/model-setup/model-setup-projection"

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

test("versioned registry resolves exact Anthropic, OpenAI, xAI, DeepSeek, and Google model ids", () => {
  const anthropic = resolveModelReasoningEffortCapability({
    model: model("anthropic", "claude-opus-4-5-20251101")
  })
  assert.deepEqual(anthropic.capability?.allowedValues, ["off", "low", "medium", "high", "max"])
  assert.equal(anthropic.transport, "anthropic-legacy-budget")
  const opus41 = resolveModelReasoningEffortCapability({
    model: model("anthropic", "claude-opus-4-1-20250805")
  })
  assert.deepEqual(opus41.capability?.allowedValues, ["off", "low", "medium", "high"])
  assert.throws(
    () =>
      assertReasoningEffortSupported({
        capability: opus41,
        effort: "max",
        modelId: "anthropic:claude-opus-4-1-20250805"
      }),
    /Thinking effort "max" is not supported/
  )

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
  assert.deepEqual(
    resolveModelReasoningEffortCapability({ model: model("openai", "gpt-5.2-2025-12-11") })
      .capability?.allowedValues,
    ["off", "low", "medium", "high", "xhigh"]
  )
  assert.deepEqual(
    resolveModelReasoningEffortCapability({ model: model("openai", "gpt-5-2025-08-07") }).capability
      ?.allowedValues,
    ["minimal", "low", "medium", "high"]
  )

  const xai = resolveModelReasoningEffortCapability({
    model: model("vercel_ai_gateway", "xai/grok-4.20-multi-agent")
  })
  assert.deepEqual(xai.capability?.allowedValues, ["low", "medium", "high", "xhigh"])

  const deepseek = resolveModelReasoningEffortCapability({
    model: model("deepseek", "deepseek-v4-pro")
  })
  assert.deepEqual(deepseek.capability?.allowedValues, ["off", "high", "max"])

  const google = resolveModelReasoningEffortCapability({
    model: model("google", "gemini-3-flash-preview")
  })
  assert.deepEqual(google.capability?.allowedValues, ["low", "medium", "high"])
  assert.equal(google.transport, "google-thinking-level")
})

test("versioned registry covers every reviewed exact model alias and snapshot", () => {
  const rows: Array<[string, string, string[]]> = [
    ["anthropic", "claude-opus-4-5-20251101", ["off", "low", "medium", "high", "max"]],
    ["anthropic", "claude-sonnet-4-5-20250929", ["off", "low", "medium", "high", "max"]],
    ["anthropic", "claude-haiku-4-5-20251001", ["off", "low", "medium", "high", "max"]],
    ["anthropic", "claude-opus-4-1-20250805", ["off", "low", "medium", "high"]],
    ["anthropic", "claude-sonnet-4-20250514", ["off", "low", "medium", "high", "max"]],
    ["openai", "gpt-5", ["minimal", "low", "medium", "high"]],
    ["openai", "gpt-5-2025-08-07", ["minimal", "low", "medium", "high"]],
    ["openai", "gpt-5.1", ["off", "low", "medium", "high"]],
    ["openai", "gpt-5.1-2025-11-13", ["off", "low", "medium", "high"]],
    ["openai", "gpt-5.2", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.2-2025-12-11", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.4", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.4-2026-03-05", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.5", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.5-2026-04-23", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.6", ["off", "low", "medium", "high", "xhigh", "max"]],
    ["openai", "gpt-5.6-sol", ["off", "low", "medium", "high", "xhigh", "max"]],
    ["openai", "gpt-5.6-terra", ["off", "low", "medium", "high", "xhigh", "max"]],
    ["openai", "gpt-5.6-luna", ["off", "low", "medium", "high", "xhigh", "max"]],
    ["openai", "o1", ["low", "medium", "high"]],
    ["openai", "o1-2024-12-17", ["low", "medium", "high"]],
    ["openai", "o3", ["low", "medium", "high"]],
    ["openai", "o3-2025-04-16", ["low", "medium", "high"]],
    ["openai", "o3-mini", ["low", "medium", "high"]],
    ["openai", "o3-mini-2025-01-31", ["low", "medium", "high"]],
    ["openai", "o4-mini", ["low", "medium", "high"]],
    ["openai", "o4-mini-2025-04-16", ["low", "medium", "high"]],
    ["deepseek", "deepseek-v4-pro", ["off", "high", "max"]],
    ["deepseek", "deepseek-v4-flash", ["off", "high", "max"]],
    ["google", "gemini-3-flash-preview", ["low", "medium", "high"]],
    ["vercel_ai_gateway", "xai/grok-4.5", ["low", "medium", "high"]],
    ["vercel_ai_gateway", "xai/grok-4.20-multi-agent", ["low", "medium", "high", "xhigh"]]
  ]

  for (const [provider, modelName, allowedValues] of rows) {
    const resolved = resolveModelReasoningEffortCapability({ model: model(provider, modelName) })
    assert.deepEqual(resolved.capability?.allowedValues, allowedValues, `${provider}:${modelName}`)
    assert.equal(resolved.capability?.version, REASONING_CAPABILITY_REGISTRY_VERSION)
    assert.ok(resolved.reference)
    assert.ok(resolved.transport)
  }
})

test("registry does not infer capabilities from similar or remote model names", () => {
  const unknownAnthropic = resolveModelReasoningEffortCapability({
    model: model("anthropic", "claude-opus-4-1-unknown-snapshot")
  })
  const unknownOpenAI = resolveModelReasoningEffortCapability({
    model: model("openai", "gpt-5.6-unknown-snapshot")
  })
  const unknownCompatible = resolveModelReasoningEffortCapability({
    model: model("custom_proxy", "gpt-5.6")
  })

  assert.equal(unknownAnthropic.capability, null)
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
  assert.doesNotThrow(() =>
    assertReasoningEffortSupported({
      capability: gpt5,
      effort: "minimal",
      modelId: "openai:gpt-5"
    })
  )
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
    model: model("custom_proxy", "vendor-reasoner")
  })

  assert.equal(capability?.version, CUSTOM_REASONING_EFFORT_DECLARATION_VERSION)
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

test("custom provider settings project explicit model capabilities and can clear them", () => {
  assert.deepEqual(
    projectCustomProviderModelInputs({
      engine: "openai",
      modelEfforts: { "vendor-reasoner": ["minimal", "high"] },
      modelNames: ["vendor-reasoner", "plain-model"]
    }),
    [
      { name: "vendor-reasoner", reasoningEfforts: ["minimal", "high"] },
      { name: "plain-model", reasoningEfforts: undefined }
    ]
  )
  assert.deepEqual(
    projectCustomProviderModelInputs({
      engine: "openai",
      modelEfforts: { "vendor-reasoner": [] },
      modelNames: ["vendor-reasoner"]
    }),
    [{ name: "vendor-reasoner", reasoningEfforts: undefined }]
  )
  assert.deepEqual(
    projectCustomProviderModelInputs({
      engine: "anthropic",
      modelEfforts: { "vendor-reasoner": ["high"] },
      modelNames: ["vendor-reasoner"]
    }),
    [{ name: "vendor-reasoner", reasoningEfforts: undefined }]
  )
})

test("Google effort is exact-model only and unsupported transports stay closed", () => {
  const flash = resolveModelReasoningEffortCapability({
    model: model("google", "gemini-3-flash-preview")
  })
  const stoppedPro = resolveModelReasoningEffortCapability({
    model: model("google", "gemini-3-pro-preview")
  })
  const budgetOnly = resolveModelReasoningEffortCapability({
    model: model("google", "gemini-2.5-flash")
  })
  const unknownAlias = resolveModelReasoningEffortCapability({
    model: model("google", "gemini-3-flash-preview-latest")
  })

  assert.deepEqual(flash.capability?.allowedValues, ["low", "medium", "high"])
  assert.equal(flash.transport, "google-thinking-level")
  assert.equal(stoppedPro.capability, null)
  assert.equal(budgetOnly.capability, null)
  assert.equal(unknownAlias.capability, null)
  assert.doesNotThrow(() =>
    assertReasoningEffortSupported({
      capability: flash,
      effort: "high",
      modelId: "google:gemini-3-flash-preview"
    })
  )
  assert.throws(
    () =>
      assertReasoningEffortSupported({
        capability: flash,
        effort: "off",
        modelId: "google:gemini-3-flash-preview"
      }),
    /Thinking effort "off" is not supported/
  )
  assert.throws(
    () =>
      assertReasoningEffortSupported({
        capability: budgetOnly,
        effort: "high",
        modelId: "google:gemini-2.5-flash"
      }),
    /Thinking effort "high" is not supported/
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
