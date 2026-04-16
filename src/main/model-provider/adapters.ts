import { ChatAnthropic } from "@langchain/anthropic"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatOpenAI } from "@langchain/openai"
import {
  API_KEY_CREDENTIAL_VARIABLE,
  BASE_URL_CREDENTIAL_VARIABLE,
  getProviderDefinition
} from "./catalog"
import {
  deleteProviderCredentials as deleteStoredProviderCredentials,
  getProviderCredential,
  setProviderCredential
} from "./secrets"
import {
  fetchAnthropicModels,
  fetchGoogleModels,
  fetchOpenAICompatibleModels,
  toRemoteModelConfigs,
  type RemoteModel
} from "./model-list"
import type {
  ModelConfig,
  ProviderCredentials,
  ProviderDefinition,
  ProviderId,
  ResolvedModelRuntimeConfig
} from "./types"

export type ChatModelInstance = ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI

export interface ChatModelOptions {
  temperature?: number
}

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
  fetchModels: (credentials: ProviderCredentials) => Promise<RemoteModel[]>
  isSupportedModel: (modelId: string, credentials: ProviderCredentials) => boolean
  providerId: ProviderId
}

const PROVIDER_ADAPTERS = {
  anthropic: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      const baseUrl = getConfiguredBaseUrl(runtimeConfig.credentials)

      console.log('[Anthropic] Creating chat model with baseUrl:', baseUrl, 'model:', runtimeConfig.modelName)

      return new ChatAnthropic({
        anthropicApiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        ...(baseUrl && { anthropicApiUrl: baseUrl }),
        model: runtimeConfig.modelName,
        temperature: options.temperature
      })
    },
    fetchModels: (credentials) => {
      const baseUrl = getConfiguredBaseUrl(credentials)
      return fetchAnthropicModels(requireApiKey(credentials, "anthropic"), baseUrl)
    },
    isSupportedModel: (modelId) => isAnthropicChatModel(modelId),
    providerId: "anthropic"
  }),
  dashscope: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      const baseURL = getConfiguredBaseUrl(runtimeConfig.credentials)

      return new ChatOpenAI({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        model: runtimeConfig.modelName,
        temperature: options.temperature,
        ...(baseURL && { configuration: { baseURL } })
      })
    },
    fetchModels: (credentials) => {
      const baseUrl = getConfiguredBaseUrl(credentials)
      return fetchOpenAICompatibleModels(
        "dashscope",
        baseUrl,
        requireApiKey(credentials, "dashscope")
      )
    },
    isSupportedModel: (modelId) => isDashScopeChatModel(modelId),
    providerId: "dashscope"
  }),
  google: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      const baseUrl = getConfiguredBaseUrl(runtimeConfig.credentials)

      return new ChatGoogleGenerativeAI({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        ...(baseUrl && { baseUrl }),
        model: runtimeConfig.modelName,
        temperature: options.temperature
      })
    },
    fetchModels: (credentials) => {
      const baseUrl = getConfiguredBaseUrl(credentials)
      return fetchGoogleModels(requireApiKey(credentials, "google"), baseUrl)
    },
    isSupportedModel: (modelId) => isGoogleChatModel(modelId),
    providerId: "google"
  }),
  kimi: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      const baseURL = getConfiguredBaseUrl(runtimeConfig.credentials)

      return new ChatOpenAI({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        model: runtimeConfig.modelName,
        temperature: options.temperature,
        ...(baseURL && { configuration: { baseURL } })
      })
    },
    fetchModels: (credentials) => {
      const baseUrl = getConfiguredBaseUrl(credentials)
      return fetchOpenAICompatibleModels(
        "kimi",
        baseUrl,
        requireApiKey(credentials, "kimi")
      )
    },
    isSupportedModel: (modelId) => isKimiChatModel(modelId),
    providerId: "kimi"
  }),
  openai: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      const baseURL = getConfiguredBaseUrl(runtimeConfig.credentials)

      return new ChatOpenAI({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        model: runtimeConfig.modelName,
        temperature: options.temperature,
        ...(baseURL && { configuration: { baseURL } })
      })
    },
    fetchModels: (credentials) => {
      const baseUrl = getConfiguredBaseUrl(credentials)
      return fetchOpenAICompatibleModels(
        "openai",
        baseUrl,
        requireApiKey(credentials, "openai")
      )
    },
    isSupportedModel: (modelId, credentials) =>
      getConfiguredBaseUrl(credentials)
        ? isOpenAICompatibleChatModel(modelId)
        : isOpenAIChatModel(modelId),
    providerId: "openai"
  })
} satisfies Record<ProviderId, ProviderAdapter>

export function listProviderAdapters(): ProviderAdapter[] {
  return Object.values(PROVIDER_ADAPTERS)
}

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return PROVIDER_ADAPTERS[providerId]
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
  const listModels = async (credentials: ProviderCredentials): Promise<ModelConfig[]> => {
    const remoteModels = await config.fetchModels(credentials)

    return toRemoteModelConfigs(config.providerId, remoteModels, (modelId) =>
      config.isSupportedModel(modelId, credentials)
    )
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
    hasCredentials: () => readProviderCredentials(definition) !== null,
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

function getConfiguredBaseUrl(credentials: ProviderCredentials): string | undefined {
  const baseUrl = credentials[BASE_URL_CREDENTIAL_VARIABLE]
  if (!baseUrl) {
    return undefined
  }

  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

function isOpenAIChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return (
    isOpenAICompatibleChatModel(normalizedModelId) &&
    (normalizedModelId.startsWith("gpt-") ||
      normalizedModelId.startsWith("chatgpt-") ||
      /^o\d/.test(normalizedModelId))
  )
}

function isOpenAICompatibleChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId)
}

function isAnthropicChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId) && normalizedModelId.startsWith("claude-")
}

function isGoogleChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId) && normalizedModelId.startsWith("gemini-")
}

function isKimiChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return (
    isChatCandidate(normalizedModelId) &&
    (normalizedModelId.startsWith("kimi-") || normalizedModelId.startsWith("moonshot-v1-"))
  )
}

function isDashScopeChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  const supportedPrefixes = [
    "abab",
    "baichuan",
    "deepseek-",
    "glm-",
    "moonshot-",
    "qwen",
    "qwq-",
    "yi-"
  ]

  return (
    isChatCandidate(normalizedModelId) &&
    supportedPrefixes.some((prefix) => normalizedModelId.startsWith(prefix))
  )
}

function isChatCandidate(normalizedModelId: string): boolean {
  const blockedFragments = [
    "audio",
    "dall-e",
    "embedding",
    "image",
    "i2i",
    "moderation",
    "rerank",
    "realtime",
    "seededit",
    "seedream",
    "speech",
    "t2i",
    "tts",
    "transcribe",
    "video",
    "whisper"
  ]

  return !blockedFragments.some((fragment) => normalizedModelId.includes(fragment))
}
