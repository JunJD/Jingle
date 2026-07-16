import assert from "node:assert/strict"
import test from "node:test"
import {
  projectModelQuickPicker,
  projectModelSelectionCatalog,
  projectModelSelectionContent,
  projectModelSelectionLoadState,
  projectSelectedModelSummary,
  resolveModelSelectionModelId
} from "../../src/renderer/src/features/model-selection/model-selection-projection"
import type { ModelConfig, Provider } from "../../src/shared/app-types"
import type {
  ModelSetupModel,
  ModelSetupProvider,
  ModelSetupSnapshot
} from "../../src/shared/model-setup"

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

function toSetupModel(model: ModelConfig): ModelSetupModel {
  const { reasoning, ...modelWithoutReasoning } = model
  return {
    ...modelWithoutReasoning,
    reasoningCapability: {
      allowedValues: reasoning ? ["off", "low", "medium", "high"] : [],
      source: "legacy-provider",
      version: "test"
    }
  }
}

function toSetupProvider(provider: Provider): ModelSetupProvider {
  return {
    ...provider,
    description: provider.description ?? {
      en_US: provider.name,
      zh_Hans: provider.name
    }
  }
}

function createSnapshot(model: ModelConfig, provider: Provider): ModelSetupSnapshot {
  const setupModel = toSetupModel(model)
  return {
    activeProviderId: provider.id,
    defaultModel: setupModel,
    defaultModelOptions: { thinkingEffort: null },
    modelProviderPaths: {
      authPath: "/tmp/auth.json",
      configPath: "/tmp/config.toml",
      customProvidersDir: "/tmp/providers",
      modelRegistryPath: "/tmp/models.json"
    },
    models: [setupModel],
    providers: [toSetupProvider(provider)]
  }
}

function getVisibleModelIds(model: ModelConfig, provider: Provider): string[] {
  const catalog = projectModelSelectionCatalog(createSnapshot(model, provider))
  return projectModelQuickPicker(catalog, null, "").rows.map((entry) => entry.id)
}

test("launcher header model picker only exposes usable configured models", () => {
  assert.deepEqual(getVisibleModelIds(createModel(), createProvider()), [
    "deepseek:deepseek-v4-pro"
  ])
  assert.deepEqual(
    getVisibleModelIds(
      createModel({ provider: "anthropic" }),
      createProvider({
        customConfiguration: {
          status: "no-configure"
        },
        id: "anthropic",
        name: "Anthropic"
      })
    ),
    []
  )
  assert.deepEqual(
    getVisibleModelIds(createModel(), createProvider({ modelListStatus: "error" })),
    []
  )
  assert.deepEqual(
    getVisibleModelIds(createModel({ status: "no-configure" }), createProvider()),
    []
  )
})

test("model selection resolves a fresh draft to the canonical default model", () => {
  const model = createModel()
  const catalog = projectModelSelectionCatalog(createSnapshot(model, createProvider()))
  const effectiveModelId = resolveModelSelectionModelId(catalog, null)

  assert.equal(effectiveModelId, model.id)
  assert.deepEqual(projectSelectedModelSummary(catalog, effectiveModelId), {
    kind: "configured",
    modelId: model.id,
    name: model.name,
    providerId: model.provider
  })
})

test("model selection keeps reload failures ahead of a stale snapshot", () => {
  const snapshot = createSnapshot(createModel(), createProvider())

  assert.equal(
    projectModelSelectionLoadState({ error: "reload failed", loading: true, snapshot }),
    "loading"
  )
  assert.equal(
    projectModelSelectionLoadState({ error: "reload failed", loading: false, snapshot }),
    "error"
  )
  assert.equal(projectModelSelectionLoadState({ error: null, loading: false, snapshot }), "ready")
})

test("model selection distinguishes pending discovery from missing configuration", () => {
  const model = createModel()
  const discoveryCatalog = projectModelSelectionCatalog(
    createSnapshot(
      model,
      createProvider({
        customConfiguration: { status: "active" },
        modelListStatus: "no-configure"
      })
    )
  )
  assert.deepEqual(discoveryCatalog.providers[0]?.availability, {
    kind: "discovery-required"
  })
  assert.deepEqual(projectSelectedModelSummary(discoveryCatalog, model.id), {
    kind: "unavailable",
    modelId: model.id,
    providerId: model.provider,
    reason: "provider-discovery-required"
  })
  assert.deepEqual(projectModelQuickPicker(discoveryCatalog, model.id, ""), {
    notice: {
      kind: "discovery-required",
      providerId: "deepseek",
      providerName: "DeepSeek"
    },
    rows: []
  })

  const configurationCatalog = projectModelSelectionCatalog(
    createSnapshot(
      model,
      createProvider({
        customConfiguration: { status: "no-configure" },
        modelListStatus: "no-configure"
      })
    )
  )
  assert.deepEqual(configurationCatalog.providers[0]?.availability, {
    kind: "configuration-required"
  })
  assert.deepEqual(projectModelQuickPicker(configurationCatalog, model.id, "").notice, {
    kind: "configuration-required",
    providerId: "deepseek",
    providerName: "DeepSeek"
  })

  const providerErrorCatalog = projectModelSelectionCatalog(
    createSnapshot(
      model,
      createProvider({
        modelListError: "registry unavailable",
        modelListStatus: "error"
      })
    )
  )
  assert.deepEqual(providerErrorCatalog.providers[0]?.availability, {
    detail: "registry unavailable",
    kind: "error"
  })
  assert.deepEqual(projectModelQuickPicker(providerErrorCatalog, model.id, "").notice, {
    detail: "registry unavailable",
    kind: "provider-error",
    providerId: "deepseek",
    providerName: "DeepSeek"
  })

  const noActiveModelsSnapshot = createSnapshot(model, createProvider())
  noActiveModelsSnapshot.models = []
  const noActiveModelsCatalog = projectModelSelectionCatalog(noActiveModelsSnapshot)
  assert.deepEqual(noActiveModelsCatalog.providers[0]?.availability, {
    kind: "discovery-required"
  })
  assert.deepEqual(projectModelQuickPicker(noActiveModelsCatalog, null, "").notice, {
    kind: "discovery-required",
    providerId: "deepseek",
    providerName: "DeepSeek"
  })
})

test("model selection fails closed for inactive models and unavailable providers", () => {
  const inactiveModel = createModel({ status: "credential-removed" })
  const inactiveCatalog = projectModelSelectionCatalog(
    createSnapshot(inactiveModel, createProvider())
  )
  assert.deepEqual(projectSelectedModelSummary(inactiveCatalog, inactiveModel.id), {
    kind: "unavailable",
    modelId: inactiveModel.id,
    providerId: inactiveModel.provider,
    reason: "inactive-model"
  })
  const inactiveContent = projectModelSelectionContent(inactiveCatalog, inactiveModel.id, null)
  assert.equal(inactiveContent.hasSelectionIssue, true)
  assert.deepEqual(inactiveContent.models, [])
  assert.deepEqual(projectModelQuickPicker(inactiveCatalog, inactiveModel.id, "").notice, {
    kind: "catalog-error"
  })

  const unknownProviderModel = createModel({ provider: "anthropic" })
  const unknownProviderCatalog = projectModelSelectionCatalog(
    createSnapshot(unknownProviderModel, createProvider())
  )
  assert.deepEqual(
    projectModelQuickPicker(unknownProviderCatalog, unknownProviderModel.id, "").notice,
    { kind: "catalog-error" }
  )

  const model = createModel()
  const unavailableCatalog = projectModelSelectionCatalog(
    createSnapshot(
      model,
      createProvider({
        customConfiguration: { status: "no-configure" }
      })
    )
  )
  assert.deepEqual(projectSelectedModelSummary(unavailableCatalog, model.id), {
    kind: "unavailable",
    modelId: model.id,
    providerId: model.provider,
    reason: "provider-configuration-required"
  })
})
