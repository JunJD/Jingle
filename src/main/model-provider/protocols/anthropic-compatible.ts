import { ChatAnthropic } from "@langchain/anthropic"
import { AIMessage, type BaseMessage } from "@langchain/core/messages"
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager"
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs"
import type { ChatModelOptions, ProtocolCreateModelInput } from "./types"
import { isChatCandidate } from "./openai-compatible"
import { resolveRequiredMaxOutputTokens } from "../model-limits"

type AnthropicContentBlock = Record<string, unknown> & { type: string }
type AnthropicThinkingConfig = { budget_tokens: number; type: "enabled" }

export function createAnthropicChatModel(
  input: ProtocolCreateModelInput & {
    apiKey: string
    baseURL?: string
    thinkingMode?: boolean
  }
): ChatAnthropic {
  const { apiKey, baseURL, headers, options, runtimeConfig, thinkingMode = false } = input
  const ModelClass = thinkingMode ? DeepSeekAnthropicChatModel : ChatAnthropic
  const thinking = thinkingMode
    ? ({ budget_tokens: 1024, type: "enabled" } as const)
    : createAnthropicThinking(runtimeConfig.thinkingEffort)

  return new ModelClass({
    ...createAnthropicCredentialOptions(apiKey, headers),
    ...(baseURL ? { anthropicApiUrl: baseURL } : {}),
    ...createAnthropicToolCallOptions(options),
    maxTokens: resolveAnthropicMaxTokens(runtimeConfig.maxOutputTokens),
    model: runtimeConfig.modelName,
    ...(thinking ? { thinking } : {}),
    ...(thinking ? {} : { temperature: options.temperature })
  })
}

function createAnthropicThinking(
  thinkingEffort: ProtocolCreateModelInput["runtimeConfig"]["thinkingEffort"]
): AnthropicThinkingConfig | undefined {
  if (!thinkingEffort || thinkingEffort === "off") {
    return undefined
  }

  const budgetTokensByEffort = {
    high: 16000,
    low: 1024,
    max: 32000,
    medium: 4096
  }

  return {
    budget_tokens: budgetTokensByEffort[thinkingEffort],
    type: "enabled"
  }
}

function resolveAnthropicMaxTokens(maxOutputTokens: number | undefined): number {
  return resolveRequiredMaxOutputTokens(maxOutputTokens)
}

export function createAnthropicCredentialOptions(
  apiKey: string,
  headers?: Record<string, string>
): {
  apiKey: string
  clientOptions: {
    authToken: null
    defaultHeaders?: Record<string, string>
  }
} {
  return {
    apiKey,
    clientOptions: {
      authToken: null,
      ...(headers ? { defaultHeaders: headers } : {})
    }
  }
}

export function createAnthropicToolCallOptions(options: ChatModelOptions): {
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

export class DeepSeekAnthropicChatModel extends ChatAnthropic {
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

export function isAnthropicChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId) && normalizedModelId.startsWith("claude-")
}

export function isDeepSeekThinkingModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()

  return (
    normalizedModelId === "deepseek-reasoner" ||
    normalizedModelId.startsWith("deepseek-v4-") ||
    normalizedModelId.startsWith("deepseek_v4_")
  )
}
