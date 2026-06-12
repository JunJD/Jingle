import type { ModelConfig, ProviderDefinition, ProviderId } from "./types"
import { listCustomProviderDefinitions, listCustomProviderModels } from "./custom-providers"
import {
  listDeclarativeProviderDefinitions,
  listDeclarativeProviderModels
} from "./declarative-providers"
import { modelSupportsReasoning } from "./model-metadata"
import { listRegistryModels, listRegistryProviderDefinitions } from "./registry"

const MODEL_ID_SEPARATOR = ":"
const LLM_MODEL_TYPE = "llm"
export const API_KEY_CREDENTIAL_VARIABLE = "apiKey"

export interface ProviderModelId {
  modelName: string
  providerId: ProviderId
}

export function toProviderModelId(providerId: ProviderId, modelName: string): string {
  return `${providerId}${MODEL_ID_SEPARATOR}${modelName}`
}

function apiKeyCredential(
  label: string,
  placeholder: string
): ProviderDefinition["credentialFormSchemas"][number] {
  return {
    label: {
      en_US: label,
      zh_Hans: label
    },
    name: label,
    placeholder: {
      en_US: placeholder,
      zh_Hans: placeholder
    },
    required: true,
    type: "secret-input",
    variable: API_KEY_CREDENTIAL_VARIABLE
  }
}

const PROVIDERS: ProviderDefinition[] = [
  {
    configurateMethods: ["fetch-from-remote"],
    credentialFormSchemas: [apiKeyCredential("Anthropic API Key", "sk-ant-...")],
    description: {
      en_US: "Anthropic Claude chat models.",
      zh_Hans: "Anthropic Claude 聊天模型。"
    },
    id: "anthropic",
    label: {
      en_US: "Anthropic",
      zh_Hans: "Anthropic"
    },
    name: "Anthropic",
    supportedModelTypes: [LLM_MODEL_TYPE]
  },
  {
    configurateMethods: ["fetch-from-remote"],
    credentialFormSchemas: [apiKeyCredential("OpenAI API Key", "sk-...")],
    description: {
      en_US: "OpenAI chat and reasoning models.",
      zh_Hans: "OpenAI 聊天和推理模型。"
    },
    id: "openai",
    label: {
      en_US: "OpenAI",
      zh_Hans: "OpenAI"
    },
    name: "OpenAI",
    supportedModelTypes: [LLM_MODEL_TYPE]
  },
  {
    configurateMethods: ["fetch-from-remote"],
    credentialFormSchemas: [apiKeyCredential("Google API Key", "AIza...")],
    description: {
      en_US: "Google Gemini chat models.",
      zh_Hans: "Google Gemini 聊天模型。"
    },
    id: "google",
    label: {
      en_US: "Google",
      zh_Hans: "Google"
    },
    name: "Google",
    supportedModelTypes: [LLM_MODEL_TYPE]
  },
  {
    configurateMethods: ["fetch-from-remote"],
    credentialFormSchemas: [apiKeyCredential("DashScope API Key", "sk-...")],
    description: {
      en_US: "Alibaba Cloud DashScope OpenAI-compatible chat models.",
      zh_Hans: "阿里云 DashScope OpenAI-compatible 聊天模型。"
    },
    id: "dashscope",
    label: {
      en_US: "DashScope",
      zh_Hans: "DashScope"
    },
    name: "DashScope",
    supportedModelTypes: [LLM_MODEL_TYPE]
  },
  {
    configurateMethods: ["fetch-from-remote"],
    credentialFormSchemas: [apiKeyCredential("DeepSeek API Key", "sk-...")],
    description: {
      en_US: "DeepSeek OpenAI-compatible chat and reasoning models.",
      zh_Hans: "DeepSeek OpenAI-compatible 聊天和推理模型。"
    },
    id: "deepseek",
    label: {
      en_US: "DeepSeek",
      zh_Hans: "DeepSeek"
    },
    name: "DeepSeek",
    supportedModelTypes: [LLM_MODEL_TYPE]
  },
  {
    configurateMethods: ["customizable-model"],
    credentialFormSchemas: [],
    description: {
      en_US: "Use an authenticated Codex CLI as an external agent provider.",
      zh_Hans: "使用已登录的 Codex CLI 作为外部 Agent provider。"
    },
    id: "codex",
    label: {
      en_US: "Codex CLI",
      zh_Hans: "Codex CLI"
    },
    name: "Codex CLI",
    source: "builtin",
    supportedModelTypes: [LLM_MODEL_TYPE]
  }
]

const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: toProviderModelId("anthropic", "claude-opus-4-5-20251101"),
    name: "Claude Opus 4.5",
    provider: "anthropic",
    model: "claude-opus-4-5-20251101",
    description: "Premium model with maximum intelligence",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("anthropic", "claude-sonnet-4-5-20250929"),
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    description: "Best balance of intelligence, speed, and cost for agents",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("anthropic", "claude-haiku-4-5-20251001"),
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Fastest model with near-frontier intelligence",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("anthropic", "claude-opus-4-1-20250805"),
    name: "Claude Opus 4.1",
    provider: "anthropic",
    model: "claude-opus-4-1-20250805",
    description: "Previous generation premium model with extended thinking",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("anthropic", "claude-sonnet-4-20250514"),
    name: "Claude Sonnet 4",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    description: "Fast and capable previous generation model",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "gpt-5.2"),
    name: "GPT-5.2",
    provider: "openai",
    model: "gpt-5.2",
    description: "Latest flagship with enhanced coding and agentic capabilities",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "gpt-5.1"),
    name: "GPT-5.1",
    provider: "openai",
    model: "gpt-5.1",
    description: "Advanced reasoning and robust performance",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "o3"),
    name: "o3",
    provider: "openai",
    model: "o3",
    description: "Advanced reasoning for complex problem-solving",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "o3-mini"),
    name: "o3 Mini",
    provider: "openai",
    model: "o3-mini",
    description: "Cost-effective reasoning with faster response times",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "o4-mini"),
    name: "o4 Mini",
    provider: "openai",
    model: "o4-mini",
    description: "Fast, efficient reasoning model succeeding o3",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "o1"),
    name: "o1",
    provider: "openai",
    model: "o1",
    description: "Premium reasoning for research, coding, math and science",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "gpt-4.1"),
    name: "GPT-4.1",
    provider: "openai",
    model: "gpt-4.1",
    description: "Strong instruction-following with 1M context window",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "gpt-4.1-mini"),
    name: "GPT-4.1 Mini",
    provider: "openai",
    model: "gpt-4.1-mini",
    description: "Faster, smaller version balancing performance and efficiency",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "gpt-4.1-nano"),
    name: "GPT-4.1 Nano",
    provider: "openai",
    model: "gpt-4.1-nano",
    description: "Most cost-efficient for lighter tasks",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "gpt-4o"),
    name: "GPT-4o",
    provider: "openai",
    model: "gpt-4o",
    description: "Versatile model for text generation and comprehension",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("openai", "gpt-4o-mini"),
    name: "GPT-4o Mini",
    provider: "openai",
    model: "gpt-4o-mini",
    description: "Cost-efficient variant with faster response times",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("dashscope", "glm-4.6"),
    name: "GLM-4.6",
    provider: "dashscope",
    model: "glm-4.6",
    description: "Zhipu GLM model routed through DashScope's OpenAI-compatible API",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("dashscope", "qwen3.5-plus"),
    name: "Qwen 3.5 Plus",
    provider: "dashscope",
    model: "qwen3.5-plus",
    description: "DashScope multimodal Qwen model with image understanding support",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("dashscope", "qwen-max"),
    name: "Qwen Max",
    provider: "dashscope",
    model: "qwen-max",
    description: "High-capability Qwen model served by DashScope",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("dashscope", "qwen-plus"),
    name: "Qwen Plus",
    provider: "dashscope",
    model: "qwen-plus",
    description: "Balanced Qwen model for general-purpose tasks",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("deepseek", "deepseek-v4-pro"),
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    description: "Frontier reasoning and coding model exposed by DeepSeek's OpenAI-compatible API",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("deepseek", "deepseek-v4-flash"),
    name: "DeepSeek V4 Flash",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    description: "Faster general-purpose DeepSeek model with OpenAI-compatible API access",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("google", "gemini-3-pro-preview"),
    name: "Gemini 3 Pro Preview",
    provider: "google",
    model: "gemini-3-pro-preview",
    description: "State-of-the-art reasoning and multimodal understanding",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("google", "gemini-3-flash-preview"),
    name: "Gemini 3 Flash Preview",
    provider: "google",
    model: "gemini-3-flash-preview",
    description: "Fast frontier-class model with low latency and cost",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("google", "gemini-2.5-pro"),
    name: "Gemini 2.5 Pro",
    provider: "google",
    model: "gemini-2.5-pro",
    description: "High-capability model for complex reasoning and coding",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("google", "gemini-2.5-flash"),
    name: "Gemini 2.5 Flash",
    provider: "google",
    model: "gemini-2.5-flash",
    description: "Lightning-fast with balance of intelligence and latency",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("google", "gemini-2.5-flash-lite"),
    name: "Gemini 2.5 Flash Lite",
    provider: "google",
    model: "gemini-2.5-flash-lite",
    description: "Fast, low-cost, high-performance model",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("codex", "current"),
    name: "Current Codex model",
    provider: "codex",
    model: "current",
    description: "The model currently configured in the local Codex CLI.",
    fetchFrom: "customizable-model",
    modelType: "llm",
    status: "active"
  }
]

export function listProviderDefinitions(): ProviderDefinition[] {
  return [
    ...PROVIDERS,
    ...listDeclarativeProviderDefinitions(),
    ...listCustomProviderDefinitions(),
    ...listRegistryProviderDefinitions()
  ]
}

export function getProviderDefinition(providerId: string): ProviderDefinition | undefined {
  return listProviderDefinitions().find((provider) => provider.id === providerId)
}

export function listModelCatalog(): ModelConfig[] {
  return [
    ...AVAILABLE_MODELS,
    ...listDeclarativeProviderModels(),
    ...listCustomProviderModels(),
    ...listRegistryModels()
  ].map((model) => ({
    ...model,
    reasoning: model.reasoning ?? modelSupportsReasoning(model.model)
  }))
}

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return listModelCatalog().find((model) => model.id === modelId)
}

export function parseProviderModelId(modelId: string): ProviderModelId {
  const separatorIndex = modelId.indexOf(MODEL_ID_SEPARATOR)
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    throw new Error(`Model id must be provider-scoped: ${modelId}`)
  }

  const provider = modelId.slice(0, separatorIndex)
  const providerDefinition = getProviderDefinition(provider)
  if (!providerDefinition) {
    throw new Error(`Model provider is not configured: ${provider}`)
  }

  return {
    modelName: modelId.slice(separatorIndex + 1),
    providerId: providerDefinition.id
  }
}
