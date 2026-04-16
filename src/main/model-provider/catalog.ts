import type { ModelConfig, ProviderDefinition, ProviderId } from "./types"

const MODEL_ID_SEPARATOR = ":"
const LLM_MODEL_TYPE = "llm"
export const API_KEY_CREDENTIAL_VARIABLE = "apiKey"
export const BASE_URL_CREDENTIAL_VARIABLE = "baseUrl"

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

function textCredential(
  label: string,
  placeholder: string,
  variable: string,
  tooltip?: ProviderDefinition["credentialFormSchemas"][number]["tooltip"]
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
    required: false,
    tooltip,
    type: "text-input",
    variable
  }
}

function baseUrlCredential(
  placeholder: string,
  tooltip?: ProviderDefinition["credentialFormSchemas"][number]["tooltip"]
): ProviderDefinition["credentialFormSchemas"][number] {
  return textCredential("Base URL", placeholder, BASE_URL_CREDENTIAL_VARIABLE, tooltip)
}

const PROVIDERS: ProviderDefinition[] = [
  {
    configurateMethods: ["fetch-from-remote"],
    credentialFormSchemas: [
      apiKeyCredential("Anthropic API Key", "sk-ant-..."),
      baseUrlCredential("https://api.anthropic.com", {
        en_US: "Optional. Override the Anthropic API base URL.",
        zh_Hans: "可选。覆盖 Anthropic API 的基础地址。"
      })
    ],
    description: {
      en_US: "Anthropic Claude chat models with optional custom API base URL.",
      zh_Hans: "Anthropic Claude 聊天模型，支持可选自定义 API 基础地址。"
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
    credentialFormSchemas: [
      apiKeyCredential("OpenAI API Key", "sk-..."),
      baseUrlCredential(
        "https://api.openai.com/v1",
        {
          en_US:
            "Optional. Override the OpenAI API base URL or use an OpenAI-compatible endpoint.",
          zh_Hans: "可选。覆盖 OpenAI API 基础地址，或接入 OpenAI-compatible endpoint。"
        }
      )
    ],
    description: {
      en_US: "OpenAI chat and reasoning models, or OpenAI-compatible models via a custom base URL.",
      zh_Hans: "OpenAI 聊天和推理模型，或通过自定义 base URL 接入的 OpenAI-compatible 模型。"
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
    credentialFormSchemas: [
      apiKeyCredential("Gemini API Key", "AIza..."),
      baseUrlCredential("https://generativelanguage.googleapis.com", {
        en_US: "Optional. Override the Gemini API base URL.",
        zh_Hans: "可选。覆盖 Gemini API 的基础地址。"
      })
    ],
    description: {
      en_US: "Google Gemini chat models via the Gemini API, with optional custom base URL.",
      zh_Hans: "通过 Gemini API 接入的 Google Gemini 聊天模型，支持可选自定义基础地址。"
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
    credentialFormSchemas: [
      apiKeyCredential("Kimi API Key", "sk-..."),
      baseUrlCredential("https://api.moonshot.cn/v1", {
        en_US: "Optional. Override the Moonshot OpenAI-compatible base URL.",
        zh_Hans: "可选。覆盖 Moonshot OpenAI-compatible 基础地址。"
      })
    ],
    description: {
      en_US: "Moonshot AI Kimi chat models via the OpenAI-compatible API, with optional custom base URL.",
      zh_Hans: "通过 OpenAI 兼容接口接入的 Moonshot AI Kimi 聊天模型，支持可选自定义基础地址。"
    },
    id: "kimi",
    label: {
      en_US: "Kimi",
      zh_Hans: "Kimi"
    },
    name: "Kimi",
    supportedModelTypes: [LLM_MODEL_TYPE]
  },
  {
    configurateMethods: ["fetch-from-remote"],
    credentialFormSchemas: [
      apiKeyCredential("DashScope API Key", "sk-..."),
      baseUrlCredential("https://dashscope.aliyuncs.com/compatible-mode/v1", {
        en_US: "Optional. Override the DashScope OpenAI-compatible base URL.",
        zh_Hans: "可选。覆盖 DashScope OpenAI-compatible 基础地址。"
      })
    ],
    description: {
      en_US:
        "Alibaba Cloud DashScope OpenAI-compatible chat models with optional custom base URL.",
      zh_Hans: "阿里云 DashScope OpenAI-compatible 聊天模型，支持可选自定义基础地址。"
    },
    id: "dashscope",
    label: {
      en_US: "DashScope",
      zh_Hans: "DashScope"
    },
    name: "DashScope",
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
    id: toProviderModelId("kimi", "kimi-k2.5"),
    name: "Kimi K2.5",
    provider: "kimi",
    model: "kimi-k2.5",
    description: "Moonshot AI flagship multimodal model for agentic coding and reasoning",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("kimi", "kimi-k2-thinking"),
    name: "Kimi K2 Thinking",
    provider: "kimi",
    model: "kimi-k2-thinking",
    description: "Long-thinking Kimi model with strong agentic reasoning and tool use",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  },
  {
    id: toProviderModelId("kimi", "moonshot-v1-128k-vision-preview"),
    name: "Moonshot Vision 128K",
    provider: "kimi",
    model: "moonshot-v1-128k-vision-preview",
    description: "Vision-capable Moonshot model with a 128K context window",
    fetchFrom: "predefined-model",
    modelType: "llm",
    status: "active"
  }
]

export function listProviderDefinitions(): ProviderDefinition[] {
  return [...PROVIDERS]
}

export function getProviderDefinition(providerId: string): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === providerId)
}

export function listModelCatalog(): ModelConfig[] {
  return [...AVAILABLE_MODELS]
}

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find((model) => model.id === modelId)
}

export function parseProviderModelId(modelId: string): ProviderModelId {
  const separatorIndex = modelId.indexOf(MODEL_ID_SEPARATOR)
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    throw new Error(`Model id must be provider-scoped: ${modelId}`)
  }

  const provider = modelId.slice(0, separatorIndex)
  const providerDefinition = PROVIDERS.find((entry) => entry.id === provider)
  if (!providerDefinition) {
    throw new Error(`Model provider is not configured: ${provider}`)
  }

  return {
    modelName: modelId.slice(separatorIndex + 1),
    providerId: providerDefinition.id
  }
}
