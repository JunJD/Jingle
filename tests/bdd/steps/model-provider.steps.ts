import { After, AfterAll, Before, DataTable, Given, Then, When } from "@cucumber/cucumber"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ModelConfig,
  ModelProviderState,
  Provider,
  ProviderId
} from "../../../src/shared/app-types"
import { OpenworkWorld } from "../support/world"

type ModelProviderService = typeof import("../../../src/main/model-provider/service")
type ModelListStateModule = typeof import("../../../src/main/model-provider/model-list-state")

interface ModelProviderScenarioState {
  globalModels: ModelConfig[]
  providerModels: ModelConfig[]
  providers: Provider[]
}

interface ModelProviderWorld extends OpenworkWorld {
  modelProviderState?: ModelProviderScenarioState
}

const MODEL_PROVIDER_BDD_HOME = mkdtempSync(join(tmpdir(), "openwork-bdd-model-provider-"))
const originalOpenworkHome = process.env.OPENWORK_HOME
const originalFetch = globalThis.fetch
const requireFromStep = createRequire(__filename)

process.env.OPENWORK_HOME = MODEL_PROVIDER_BDD_HOME
installElectronSafeStorageMock()

const modelProviderService = requireFromStep(
  "../../../src/main/model-provider/service"
) as ModelProviderService
const modelListState = requireFromStep(
  "../../../src/main/model-provider/model-list-state"
) as ModelListStateModule

function installElectronSafeStorageMock(): void {
  const electronModuleId = requireFromStep.resolve("electron")
  requireFromStep("electron")
  const electronModule = requireFromStep.cache[electronModuleId]
  assert.ok(electronModule, "Expected electron module to be loaded before mocking safeStorage.")

  electronModule.exports = {
    safeStorage: {
      decryptString: (value: Buffer) => value.toString("utf8"),
      encryptString: (value: string) => Buffer.from(value, "utf8"),
      isEncryptionAvailable: () => true
    }
  }
}

function getState(world: ModelProviderWorld): ModelProviderScenarioState {
  if (!world.modelProviderState) {
    world.modelProviderState = {
      globalModels: [],
      providerModels: [],
      providers: []
    }
  }

  return world.modelProviderState
}

function resolveProviderId(providerName: string): ProviderId {
  if (providerName !== "OpenAI") {
    throw new Error(`BDD model provider steps only define OpenAI, got ${providerName}.`)
  }

  return "openai"
}

function getProvider(world: ModelProviderWorld, providerName: string): Provider {
  const providerId = resolveProviderId(providerName)
  const provider = getState(world).providers.find((entry) => entry.id === providerId)
  assert.ok(provider, `Expected provider ${providerName} to be available in scenario state.`)
  return provider
}

function mockOpenAIModels(modelIds: string[]): void {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ data: modelIds.map((id) => ({ id })) }), {
      headers: { "content-type": "application/json" },
      status: 200,
      statusText: "OK"
    })
  }
}

function mockOpenAIModelListFailure(statusText: string): void {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: statusText }), {
      headers: { "content-type": "application/json" },
      status: 401,
      statusText
    })
  }
}

async function saveOpenAICredentials(): Promise<void> {
  mockOpenAIModels(["gpt-credential-check"])
  await modelProviderService.setProviderCredentialsForUI("openai", { apiKey: "sk-bdd" })
}

async function readModelProviderStateViaRenderer(
  world: OpenworkWorld
): Promise<ModelProviderState> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: {
          models: {
            getState: () => Promise<ModelProviderState>
          }
        }
      }
    ).api.models.getState()
  })
}

Before({ tags: "@model-provider" }, function (this: ModelProviderWorld) {
  modelProviderService.deleteProviderCredentialsForUI("openai")
  modelListState.clearProviderModelListStates()
  globalThis.fetch = originalFetch
  this.modelProviderState = {
    globalModels: [],
    providerModels: [],
    providers: []
  }
})

After({ tags: "@model-provider" }, function (this: ModelProviderWorld) {
  modelProviderService.deleteProviderCredentialsForUI("openai")
  modelListState.clearProviderModelListStates()
  globalThis.fetch = originalFetch
  this.modelProviderState = undefined
})

AfterAll(function () {
  globalThis.fetch = originalFetch

  if (originalOpenworkHome === undefined) {
    delete process.env.OPENWORK_HOME
  } else {
    process.env.OPENWORK_HOME = originalOpenworkHome
  }

  rmSync(MODEL_PROVIDER_BDD_HOME, { force: true, recursive: true })
})

Given(
  "{word} 模型供应商已保存有效密钥",
  async function (this: ModelProviderWorld, providerName: string) {
    assert.equal(resolveProviderId(providerName), "openai")
    await saveOpenAICredentials()
  }
)

Given(
  "{word} 远程模型接口将失败并返回 {string}",
  function (this: ModelProviderWorld, providerName: string, statusText: string) {
    assert.equal(resolveProviderId(providerName), "openai")
    mockOpenAIModelListFailure(statusText)
  }
)

Given(
  "{word} 远程模型接口返回模型:",
  function (this: ModelProviderWorld, providerName: string, table: DataTable) {
    assert.equal(resolveProviderId(providerName), "openai")
    mockOpenAIModels(table.hashes().map((row) => row["模型"]))
  }
)

When(
  "系统刷新 {word} 的远程模型列表",
  async function (this: ModelProviderWorld, providerName: string) {
    const providerId = resolveProviderId(providerName)
    const response = await modelProviderService.listModelsByProviderForUI(providerId, "llm")
    const state = getState(this)
    state.providerModels = response.models
    state.providers = [
      ...state.providers.filter((provider) => provider.id !== providerId),
      response.provider
    ]
  }
)

When("系统重新读取模型供应商状态", function (this: ModelProviderWorld) {
  getState(this).providers = modelProviderService.getModelProviderStateForUI().providers
})

When("系统读取全局可用模型列表", function (this: ModelProviderWorld) {
  getState(this).globalModels = modelProviderService.listModelsForUI("llm")
})

When("系统通过 renderer 读取模型供应商状态", async function (this: ModelProviderWorld) {
  getState(this).providers = (await readModelProviderStateViaRenderer(this)).providers
})

Then(
  "{word} 模型列表状态应为 {string}",
  function (this: ModelProviderWorld, providerName: string, expectedStatus: string) {
    assert.equal(getProvider(this, providerName).modelListStatus, expectedStatus)
  }
)

Then(
  "{word} 模型列表错误应包含 {string}",
  function (this: ModelProviderWorld, providerName: string, expectedFragment: string) {
    const modelListError = getProvider(this, providerName).modelListError
    assert.ok(modelListError, `Expected ${providerName} to have a model list error.`)
    assert.ok(
      modelListError.includes(expectedFragment),
      `Expected model list error to include "${expectedFragment}", got "${modelListError}".`
    )
  }
)

Then("全局可用模型应包含 {string}", function (this: ModelProviderWorld, expectedModelId: string) {
  assert.ok(
    getState(this).globalModels.some((model) => model.id === expectedModelId),
    `Expected global models to include ${expectedModelId}.`
  )
})

Then(
  "全局可用模型不应包含 {string}",
  function (this: ModelProviderWorld, unexpectedModelId: string) {
    assert.ok(
      !getState(this).globalModels.some((model) => model.id === unexpectedModelId),
      `Expected global models not to include ${unexpectedModelId}.`
    )
  }
)

Then(
  "模型供应商状态应包含 {string}",
  function (this: ModelProviderWorld, expectedProviderId: ProviderId) {
    assert.ok(
      getState(this).providers.some((provider) => provider.id === expectedProviderId),
      `Expected model provider state to include ${expectedProviderId}.`
    )
  }
)
