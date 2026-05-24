import { ChatAnthropic } from "@langchain/anthropic"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatOpenAI } from "@langchain/openai"
import { AIMessage, type BaseMessage } from "@langchain/core/messages"
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager"
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs"
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
const DEEPSEEK_BASE_URL = "https://api.deepseek.com"
const DEEPSEEK_ANTHROPIC_BASE_URL = `${DEEPSEEK_BASE_URL}/anthropic`
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models"

export type ChatModelInstance = ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI

type AnthropicContentBlock = Record<string, unknown> & { type: string }

export interface ChatModelOptions {
  parallelToolCalls?: boolean
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
        ...createAnthropicCredentialOptions(
          requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId)
        ),
        ...createAnthropicToolCallOptions(options),
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
        ...createOpenAICompatibleToolCallOptions(options),
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
  deepseek: createApiKeyProviderAdapter({
    createChatModel: (runtimeConfig, options) => {
      const thinkingMode = isDeepSeekThinkingModel(runtimeConfig.modelName)
      const ModelClass = thinkingMode ? DeepSeekAnthropicChatModel : ChatAnthropic

      return new ModelClass({
        ...createAnthropicCredentialOptions(
          requireApiKey(runtimeConfig.credentials, runtimeConfig.providerId)
        ),
        anthropicApiUrl: DEEPSEEK_ANTHROPIC_BASE_URL,
        ...createAnthropicToolCallOptions(options),
        model: runtimeConfig.modelName,
        ...(thinkingMode ? { thinking: { budget_tokens: 1024, type: "enabled" } as const } : {}),
        ...(thinkingMode ? {} : { temperature: options.temperature })
      })
    },
    fetchModels: (apiKey) =>
      fetchOpenAICompatibleModels("deepseek", `${DEEPSEEK_BASE_URL}/models`, apiKey),
    isSupportedModel: isDeepSeekChatModel,
    providerId: "deepseek"
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
        ...createOpenAICompatibleToolCallOptions(options),
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

function createOpenAICompatibleToolCallOptions(options: ChatModelOptions): {
  modelKwargs?: Record<string, unknown>
} {
  if (options.parallelToolCalls !== false) {
    return {}
  }

  return {
    modelKwargs: {
      parallel_tool_calls: false
    }
  }
}

function createAnthropicCredentialOptions(apiKey: string): {
  apiKey: string
  clientOptions: {
    authToken: null
  }
} {
  return {
    apiKey,
    clientOptions: {
      authToken: null
    }
  }
}

function createAnthropicToolCallOptions(options: ChatModelOptions): {
  invocationKwargs?: Record<string, unknown>
} {
  if (options.parallelToolCalls !== false) {
    return {}
  }

  return {
    invocationKwargs: {
      disable_parallel_tool_use: true
    }
  }
}

class DeepSeekAnthropicChatModel extends ChatAnthropic {
  override _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    return super._generate(patchDeepSeekAnthropicThinkingReplay(messages), options, runManager)
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    yield* super._streamResponseChunks(
      patchDeepSeekAnthropicThinkingReplay(messages),
      options,
      runManager
    )
  }
}

function patchDeepSeekAnthropicThinkingReplay(messages: BaseMessage[]): BaseMessage[] {
  let changed = false
  const patched = messages.map((message) => {
    if (!AIMessage.isInstance(message)) {
      return message
    }

    const content = patchDeepSeekAnthropicAssistantContent(message)
    if (content === message.content) {
      return message
    }

    changed = true
    return new AIMessage({
      additional_kwargs: message.additional_kwargs,
      content,
      id: message.id,
      invalid_tool_calls: message.invalid_tool_calls,
      name: message.name,
      response_metadata: message.response_metadata,
      tool_calls: message.tool_calls,
      usage_metadata: message.usage_metadata
    })
  })

  return changed ? patched : messages
}

function patchDeepSeekAnthropicAssistantContent(message: AIMessage): AIMessage["content"] {
  if (Array.isArray(message.content)) {
    let normalizedThinking = false
    const blocks = message.content.map((block) => {
      if (!isAnthropicContentBlock(block)) {
        return block
      }

      if (block.type === "thinking" && typeof block.signature !== "string") {
        normalizedThinking = true
        return { ...block, signature: "" }
      }

      return block
    })

    const hasToolUse =
      Boolean(message.tool_calls?.length) ||
      blocks.some((block) => isAnthropicContentBlock(block) && block.type === "tool_use")
    const hasThinking = blocks.some(
      (block) =>
        isAnthropicContentBlock(block) &&
        (block.type === "thinking" || block.type === "redacted_thinking")
    )

    if (!hasToolUse) {
      return normalizedThinking ? blocks : message.content
    }

    return hasThinking ? blocks : [createEmptyDeepSeekThinkingBlock(), ...blocks]
  }

  if (!message.tool_calls?.length) {
    return message.content
  }

  const content: AnthropicContentBlock[] = [createEmptyDeepSeekThinkingBlock()]
  if (message.content.trim()) {
    content.push({ text: message.content, type: "text" })
  }
  return content
}

function createEmptyDeepSeekThinkingBlock(): AnthropicContentBlock {
  return {
    signature: "",
    thinking: "",
    type: "thinking"
  }
}

function isAnthropicContentBlock(value: unknown): value is AnthropicContentBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  )
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

function isDeepSeekChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()

  return (
    isChatCandidate(normalizedModelId) &&
    (normalizedModelId.startsWith("deepseek-") || normalizedModelId.startsWith("deepseek_v"))
  )
}

function isDeepSeekThinkingModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()

  return (
    normalizedModelId === "deepseek-reasoner" ||
    normalizedModelId.startsWith("deepseek-v4-") ||
    normalizedModelId.startsWith("deepseek_v4_")
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
