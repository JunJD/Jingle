import { ChatAnthropic } from "@langchain/anthropic"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatOpenAI } from "@langchain/openai"
import { API_KEY_CREDENTIAL_VARIABLE, getProviderDefinition } from "./catalog"
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

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models"

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
  fetchModels: (apiKey: string) => Promise<RemoteModel[]>
  isSupportedModel: (modelId: string) => boolean
  providerId: ProviderId
}

const PROVIDER_ADAPTERS = {
  anthropic: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      return new ChatAnthropic({
        anthropicApiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        model: runtimeConfig.modelName,
        temperature: options.temperature
      })
    },
    fetchModels: fetchAnthropicModels,
    isSupportedModel: isAnthropicChatModel,
    providerId: "anthropic"
  }),
  dashscope: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      return new ChatOpenAI({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        model: runtimeConfig.modelName,
        temperature: options.temperature,
        configuration: {
          baseURL: DASHSCOPE_BASE_URL
        }
      })
    },
    fetchModels: (apiKey) =>
      fetchOpenAICompatibleModels("dashscope", `${DASHSCOPE_BASE_URL}/models`, apiKey),
    isSupportedModel: isDashScopeChatModel,
    providerId: "dashscope"
  }),
  google: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      return new ChatGoogleGenerativeAI({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        model: runtimeConfig.modelName,
        temperature: options.temperature
      })
    },
    fetchModels: fetchGoogleModels,
    isSupportedModel: isGoogleChatModel,
    providerId: "google"
  }),
  openai: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      return new ChatOpenAI({
        apiKey: requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId),
        model: runtimeConfig.modelName,
        temperature: options.temperature
      })
    },
    fetchModels: (apiKey) => fetchOpenAICompatibleModels("openai", OPENAI_MODELS_URL, apiKey),
    isSupportedModel: isOpenAIChatModel,
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

function isOpenAIChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return (
    isChatCandidate(normalizedModelId) &&
    (normalizedModelId.startsWith("gpt-") ||
      normalizedModelId.startsWith("chatgpt-") ||
      /^o\d/.test(normalizedModelId))
  )
}

function isAnthropicChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId) && normalizedModelId.startsWith("claude-")
}

function isGoogleChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId) && normalizedModelId.startsWith("gemini-")
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
    "moderation",
    "rerank",
    "realtime",
    "speech",
    "tts",
    "transcribe",
    "video",
    "whisper"
  ]

  return !blockedFragments.some((fragment) => normalizedModelId.includes(fragment))
}
