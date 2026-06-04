import { API_KEY_CREDENTIAL_VARIABLE, getProviderDefinition } from "./catalog"
import { getCustomProviderConfig, listCustomProviderConfigs } from "./custom-providers"
import {
  getDeclarativeProviderConfig,
  listDeclarativeProviderConfigs
} from "./declarative-providers"
import {
  deleteProviderCredentials as deleteStoredProviderCredentials,
  getProviderCredential,
  hasProviderCredentials,
  setProviderCredential
} from "./secrets"
import {
  fetchAnthropicModels,
  fetchGoogleModels,
  fetchOpenAICompatibleModels,
  listCatalogModelsByProvider,
  toRemoteModelConfigs,
  type RemoteModel
} from "./model-list"
import { modelSupportsReasoning } from "./model-metadata"
import {
  createAnthropicChatModel,
  isAnthropicChatModel,
  isDeepSeekThinkingModel
} from "./protocols/anthropic-compatible"
import { createCodexCliChatModel } from "./protocols/codex-cli"
import { createGoogleChatModel, isGoogleChatModel } from "./protocols/google"
import {
  createOpenAICompatibleChatModel,
  isCustomProviderChatModel,
  isDashScopeChatModel,
  isDeepSeekChatModel,
  isOpenAIChatModel
} from "./protocols/openai-compatible"
import type { ChatModelInstance, ChatModelOptions } from "./protocols/types"
import type {
  CustomProviderConfig,
  ModelConfig,
  ProviderCredentials,
  ProviderDefinition,
  ProviderId,
  ResolvedModelRuntimeConfig
} from "./types"

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
const DEEPSEEK_BASE_URL = "https://api.deepseek.com"
const DEEPSEEK_ANTHROPIC_BASE_URL = `${DEEPSEEK_BASE_URL}/anthropic`
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models"

export type { ChatModelInstance, ChatModelOptions }

export interface ProviderAdapter {
  createChatModel: (
    runtimeConfig: ResolvedModelRuntimeConfig,
    options: ChatModelOptions
  ) => ChatModelInstance
  deleteCredentials: () => void
  definition: ProviderDefinition
  getCredentials: () => ProviderCredentials | null
  hasCredentials: () => boolean
  listModels: (credentials: ProviderCredentials) => Promise<ModelConfig[]>
  normalizeCredentials: (credentials: Record<string, string>) => ProviderCredentials
  saveCredentials: (credentials: ProviderCredentials) => void
  validateCredentials: (credentials: ProviderCredentials) => Promise<void>
}

type ProviderAdapterConfig = {
  createChatModel: (
    runtimeConfig: ResolvedModelRuntimeConfig,
    options: ChatModelOptions
  ) => ChatModelInstance
  fetchModels: (apiKey: string) => Promise<RemoteModel[]>
  isSupportedModel: (modelId: string) => boolean
  providerId: ProviderId
}

const BUILTIN_PROVIDER_ADAPTERS = {
  anthropic: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) =>
      createAnthropicChatModel({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        options,
        runtimeConfig
      }),
    fetchModels: fetchAnthropicModels,
    isSupportedModel: isAnthropicChatModel,
    providerId: "anthropic"
  }),
  codex: createCodexCliProviderAdapter("codex"),
  dashscope: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) =>
      createOpenAICompatibleChatModel({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        baseURL: DASHSCOPE_BASE_URL,
        options,
        runtimeConfig
      }),
    fetchModels: (apiKey) =>
      fetchOpenAICompatibleModels("dashscope", `${DASHSCOPE_BASE_URL}/models`, apiKey),
    isSupportedModel: isDashScopeChatModel,
    providerId: "dashscope"
  }),
  deepseek: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) =>
      createAnthropicChatModel({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        baseURL: DEEPSEEK_ANTHROPIC_BASE_URL,
        options,
        runtimeConfig,
        thinkingMode: isDeepSeekThinkingModel(runtimeConfig.modelName)
      }),
    fetchModels: (apiKey) =>
      fetchOpenAICompatibleModels("deepseek", `${DEEPSEEK_BASE_URL}/models`, apiKey),
    isSupportedModel: isDeepSeekChatModel,
    providerId: "deepseek"
  }),
  google: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) =>
      createGoogleChatModel({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        options,
        runtimeConfig
      }),
    fetchModels: fetchGoogleModels,
    isSupportedModel: isGoogleChatModel,
    providerId: "google"
  }),
  openai: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) =>
      createOpenAICompatibleChatModel({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        options,
        runtimeConfig
      }),
    fetchModels: (apiKey) => fetchOpenAICompatibleModels("openai", OPENAI_MODELS_URL, apiKey),
    isSupportedModel: isOpenAIChatModel,
    providerId: "openai"
  })
} satisfies Record<string, ProviderAdapter>

export function listProviderAdapters(): ProviderAdapter[] {
  return Object.values(BUILTIN_PROVIDER_ADAPTERS)
    .concat(listDeclarativeProviderAdapters())
    .concat(listCustomProviderAdapters())
    .concat(createCatalogOnlyProviderAdapters())
}

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  const builtinAdapter = BUILTIN_PROVIDER_ADAPTERS[providerId]
  if (builtinAdapter) {
    return builtinAdapter
  }

  const customConfig = getCustomProviderConfig(providerId)
  if (customConfig) {
    return createProviderConfigAdapter(customConfig.name, customConfig)
  }

  const declarativeConfig = getDeclarativeProviderConfig(providerId)
  if (declarativeConfig) {
    return createProviderConfigAdapter(declarativeConfig.name, declarativeConfig)
  }

  return createCatalogOnlyProviderAdapter(providerId)
}

export async function listRemoteModelsByProvider(
  providerId: ProviderId,
  credentials: ProviderCredentials
): Promise<ModelConfig[]> {
  return getProviderAdapter(providerId).listModels(credentials)
}

export async function validateRemoteProviderCredentials(
  providerId: ProviderId,
  credentials: ProviderCredentials
): Promise<void> {
  await getProviderAdapter(providerId).validateCredentials(credentials)
}

export function createProviderChatModelFromAdapter(
  runtimeConfig: ResolvedModelRuntimeConfig,
  options: ChatModelOptions = {}
): ChatModelInstance {
  return getProviderAdapter(runtimeConfig.providerId).createChatModel(runtimeConfig, options)
}

function createApiKeyProviderAdapter(config: ProviderAdapterConfig): ProviderAdapter {
  const definition = requireProviderDefinition(config.providerId)
  const requiredCredentialVariables = listRequiredCredentialVariables(definition)
  const listModels = async (credentials: ProviderCredentials): Promise<ModelConfig[]> => {
    const apiKey = requireApiKey(credentials, config.providerId)
    const remoteModels = await config.fetchModels(apiKey)

    return toRemoteModelConfigs(config.providerId, remoteModels, config.isSupportedModel)
  }

  return {
    createChatModel: config.createChatModel,
    definition,
    deleteCredentials: () => {
      deleteStoredProviderCredentials(
        definition.id,
        definition.credentialFormSchemas.map((schema) => schema.variable)
      )
    },
    getCredentials: () => readProviderCredentials(definition),
    hasCredentials: () => hasProviderCredentials(definition.id, requiredCredentialVariables),
    listModels,
    normalizeCredentials: (credentials) => normalizeProviderCredentials(definition, credentials),
    saveCredentials: (credentials) => {
      const normalizedCredentials = normalizeProviderCredentials(definition, credentials)
      Object.entries(normalizedCredentials).forEach(([variable, value]) => {
        setProviderCredential(definition.id, variable, value)
      })
    },
    validateCredentials: async (credentials) => {
      await listModels(credentials)
    }
  }
}

function createCodexCliProviderAdapter(providerId: ProviderId): ProviderAdapter {
  const definition = requireProviderDefinition(providerId)

  return {
    createChatModel: (runtimeConfig) => createCodexCliChatModel(runtimeConfig.modelName),
    definition,
    deleteCredentials: () => {},
    getCredentials: () => ({}),
    hasCredentials: () => true,
    listModels: async () => listCatalogModelsByProvider(definition.id, "active"),
    normalizeCredentials: () => ({}),
    saveCredentials: () => {},
    validateCredentials: async () => {}
  }
}

function listCustomProviderAdapters(): ProviderAdapter[] {
  return listCustomProviderConfigs().map((provider) =>
    createProviderConfigAdapter(provider.name, provider)
  )
}

function listDeclarativeProviderAdapters(): ProviderAdapter[] {
  return listDeclarativeProviderConfigs().map((provider) =>
    createProviderConfigAdapter(provider.name, provider)
  )
}

function createCatalogOnlyProviderAdapters(): ProviderAdapter[] {
  return ["local"]
    .map((providerId) => getProviderDefinition(providerId))
    .filter((definition): definition is ProviderDefinition => Boolean(definition))
    .map((definition) => createCatalogOnlyProviderAdapter(definition.id))
}

function createProviderConfigAdapter(
  providerId: ProviderId,
  providerConfig: CustomProviderConfig
): ProviderAdapter {
  const definition = requireProviderDefinition(providerId)
  const requiredCredentialVariables = listRequiredCredentialVariables(definition)
  const listModels = async (credentials: ProviderCredentials): Promise<ModelConfig[]> => {
    if (providerConfig.models.length > 0 && providerConfig.dynamic_models !== true) {
      return providerConfig.models.map((model) => ({
        contextLimit: model.context_limit,
        description: providerConfig.description,
        fetchFrom: "customizable-model",
        id: `${providerConfig.name}:${model.name}`,
        model: model.name,
        modelType: "llm",
        name: model.name,
        provider: providerConfig.name,
        reasoning: model.reasoning ?? modelSupportsReasoning(model.name),
        status: "active"
      }))
    }

    const baseURL = resolveCustomProviderBaseUrl(providerConfig, credentials)
    if (!baseURL) {
      throw new Error(`Custom provider ${providerId} needs a base URL or predefined models.`)
    }

    return toRemoteModelConfigs(
      providerConfig.name,
      await fetchOpenAICompatibleModels(
        providerConfig.name,
        `${baseURL.replace(/\/$/, "")}/models`,
        resolveCustomProviderApiKey(credentials, providerConfig)
      ),
      isCustomProviderChatModel
    )
  }

  return {
    createChatModel: (runtimeConfig, options) =>
      createCustomProviderChatModel(
        providerConfig,
        resolveCustomProviderBaseUrl(providerConfig, runtimeConfig.credentials),
        runtimeConfig,
        options
      ),
    definition,
    deleteCredentials: () => {
      deleteStoredProviderCredentials(
        definition.id,
        definition.credentialFormSchemas.map((schema) => schema.variable)
      )
    },
    getCredentials: () => readProviderCredentials(definition),
    hasCredentials: () =>
      requiredCredentialVariables.length === 0 ||
      hasProviderCredentials(definition.id, requiredCredentialVariables),
    listModels,
    normalizeCredentials: (credentials) => normalizeProviderCredentials(definition, credentials),
    saveCredentials: (credentials) => {
      const normalizedCredentials = normalizeProviderCredentials(definition, credentials)
      Object.entries(normalizedCredentials).forEach(([variable, value]) => {
        setProviderCredential(definition.id, variable, value)
      })
    },
    validateCredentials: async (credentials) => {
      await listModels(credentials)
    }
  }
}

function createCustomProviderChatModel(
  providerConfig: CustomProviderConfig,
  baseURL: string | null,
  runtimeConfig: ResolvedModelRuntimeConfig,
  options: ChatModelOptions
): ChatModelInstance {
  if (providerConfig.engine === "anthropic") {
    if (!baseURL) {
      throw new Error(`Custom Anthropic provider ${providerConfig.name} needs a base URL.`)
    }

    return createAnthropicChatModel({
      apiKey: resolveCustomProviderApiKey(runtimeConfig.credentials, providerConfig),
      baseURL,
      headers: providerConfig.headers,
      options,
      runtimeConfig
    })
  }

  if (!baseURL) {
    throw new Error(`Custom OpenAI-compatible provider ${providerConfig.name} needs a base URL.`)
  }

  return createOpenAICompatibleChatModel({
    apiKey: resolveCustomProviderApiKey(runtimeConfig.credentials, providerConfig),
    baseURL,
    headers: providerConfig.headers,
    options,
    runtimeConfig
  })
}

function createCatalogOnlyProviderAdapter(providerId: ProviderId): ProviderAdapter {
  const definition = requireProviderDefinition(providerId)
  const listModels = async (): Promise<ModelConfig[]> => {
    return listCatalogModelsByProvider(definition.id, "active")
  }

  return {
    createChatModel: () => {
      throw new Error(`${definition.name} is not supported by Jingle's LangChain chat runtime yet.`)
    },
    definition,
    deleteCredentials: () => {},
    getCredentials: () => null,
    hasCredentials: () => false,
    listModels,
    normalizeCredentials: () => ({}),
    saveCredentials: () => {},
    validateCredentials: async () => {}
  }
}

function resolveCustomProviderBaseUrl(
  providerConfig: CustomProviderConfig,
  credentials: ProviderCredentials
): string | null {
  if (providerConfig.engine === "ollama") {
    return normalizeProviderBaseUrl(
      providerConfig.base_url ?? "http://localhost:11434/v1",
      {
        ...providerConfig,
        base_path: providerConfig.base_path ?? null
      },
      credentials
    )
  }

  if (!providerConfig.base_url) {
    return null
  }

  return normalizeProviderBaseUrl(providerConfig.base_url, providerConfig, credentials)
}

function normalizeProviderBaseUrl(
  baseUrl: string,
  providerConfig: CustomProviderConfig,
  credentials: ProviderCredentials
): string {
  const resolvedBaseUrl = baseUrl.replace(
    /\$\{([^}]+)\}/g,
    (_match, name: string) =>
      credentials[name] ??
      process.env[name] ??
      providerConfig.env_vars?.find((envVar) => envVar.name === name)?.default ??
      ""
  )
  const url = new URL(resolvedBaseUrl)
  url.pathname = providerConfig.base_path?.trim()
    ? normalizeOpenAICompatibleClientPath(providerConfig.base_path)
    : normalizeOpenAICompatibleClientPath(url.pathname)

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")
  return `${url.origin}${path}${url.search}`
}

function normalizeOpenAICompatibleClientPath(path: string): string {
  const normalized = `/${path.trim().replace(/^\/+/, "").replace(/\/+$/, "")}`
  const chatCompletionsSuffix = "/chat/completions"

  if (normalized === "/") {
    return "/v1"
  }

  if (normalized.toLowerCase().endsWith(chatCompletionsSuffix)) {
    return normalized.slice(0, -chatCompletionsSuffix.length) || "/"
  }

  return normalized
}

function resolveCustomProviderApiKey(
  credentials: ProviderCredentials,
  providerConfig: CustomProviderConfig
): string {
  return providerConfig.requires_auth === false
    ? "jingle-local"
    : requireApiKey(credentials, providerConfig.name)
}

function requireProviderDefinition(providerId: ProviderId): ProviderDefinition {
  const definition = getProviderDefinition(providerId)
  if (!definition) {
    throw new Error(`Model provider is not configured: ${providerId}`)
  }

  return definition
}

function readProviderCredentials(definition: ProviderDefinition): ProviderCredentials | null {
  const credentials: ProviderCredentials = {}

  for (const schema of definition.credentialFormSchemas) {
    const value = getProviderCredential(definition.id, schema.variable)
    if (!value) {
      if (schema.required) {
        return null
      }

      continue
    }

    credentials[schema.variable] = value
  }

  return credentials
}

function listRequiredCredentialVariables(definition: ProviderDefinition): string[] {
  return definition.credentialFormSchemas
    .filter((schema) => schema.required)
    .map((schema) => schema.variable)
}

function normalizeProviderCredentials(
  definition: ProviderDefinition,
  credentials: Record<string, string>
): ProviderCredentials {
  const normalizedCredentials: ProviderCredentials = {}

  for (const schema of definition.credentialFormSchemas) {
    const value = credentials[schema.variable]?.trim()
    if (!value) {
      if (schema.required) {
        throw new Error(`Provider credential is required: ${definition.id}.${schema.variable}`)
      }

      continue
    }

    normalizedCredentials[schema.variable] = value
  }

  return normalizedCredentials
}

function requireApiKey(credentials: ProviderCredentials, providerId: ProviderId): string {
  const apiKey = credentials[API_KEY_CREDENTIAL_VARIABLE]
  if (!apiKey) {
    throw new Error(`${providerId} API key not configured`)
  }

  return apiKey
}
