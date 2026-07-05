import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { isChatCandidate } from "./openai-compatible"
import { resolveRequiredMaxOutputTokens } from "../model-limits"
import type { ProtocolCreateModelInput } from "./types"

export function createGoogleChatModel(
  input: ProtocolCreateModelInput & {
    apiKey: string
  }
): ChatGoogleGenerativeAI {
  const { apiKey, options, runtimeConfig } = input

  return new ChatGoogleGenerativeAI({
    apiKey,
    maxOutputTokens: resolveRequiredMaxOutputTokens(runtimeConfig.maxOutputTokens),
    model: runtimeConfig.modelName,
    temperature: options.temperature
  })
}

export function isGoogleChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId) && normalizedModelId.startsWith("gemini-")
}
