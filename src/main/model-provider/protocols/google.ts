import { ChatGoogleGenerativeAI, type GoogleGenerativeAIChatInput } from "@langchain/google-genai"
import { isChatCandidate } from "./openai-compatible"
import { resolveRequiredMaxOutputTokens } from "../model-limits"
import type { ProtocolCreateModelInput } from "./types"

export function createGoogleChatModel(
  input: ProtocolCreateModelInput & {
    apiKey: string
  }
): ChatGoogleGenerativeAI {
  const { apiKey, options, runtimeConfig } = input
  const thinkingConfig = createGoogleThinkingConfig(
    runtimeConfig.modelName,
    runtimeConfig.thinkingEffort,
    runtimeConfig.reasoningEffortTransport
  )

  return new ChatGoogleGenerativeAI({
    apiKey,
    maxOutputTokens: resolveRequiredMaxOutputTokens(runtimeConfig.maxOutputTokens),
    model: runtimeConfig.modelName,
    temperature: options.temperature,
    ...(thinkingConfig
      ? {
          // @langchain/google-genai@2.1.26 omits the documented MINIMAL value
          // from its type union but forwards the field unchanged to Google.
          thinkingConfig: thinkingConfig as SdkGoogleThinkingConfig
        }
      : {})
  })
}

type SdkGoogleThinkingConfig = NonNullable<GoogleGenerativeAIChatInput["thinkingConfig"]>
type GoogleThinkingConfig = Omit<SdkGoogleThinkingConfig, "thinkingLevel"> & {
  thinkingLevel: GoogleThinkingLevel
}
type GoogleThinkingLevel = NonNullable<SdkGoogleThinkingConfig["thinkingLevel"]> | "MINIMAL"
type GoogleThinkingEffort = NonNullable<ProtocolCreateModelInput["runtimeConfig"]["thinkingEffort"]>

const GOOGLE_THINKING_LEVEL_BY_EFFORT: Partial<Record<GoogleThinkingEffort, GoogleThinkingLevel>> =
  {
    high: "HIGH",
    low: "LOW",
    minimal: "MINIMAL",
    medium: "MEDIUM"
  }

function createGoogleThinkingConfig(
  modelName: string,
  thinkingEffort: ProtocolCreateModelInput["runtimeConfig"]["thinkingEffort"],
  transport: ProtocolCreateModelInput["runtimeConfig"]["reasoningEffortTransport"]
): GoogleThinkingConfig | undefined {
  if (thinkingEffort === null || thinkingEffort === undefined) {
    return undefined
  }
  if (transport !== "google-thinking-level") {
    throw new Error(
      `Google model ${modelName} has no admitted transport for thinking effort "${thinkingEffort}".`
    )
  }

  const thinkingLevel = GOOGLE_THINKING_LEVEL_BY_EFFORT[thinkingEffort]
  if (!thinkingLevel) {
    throw new Error(
      `Google thinking-level transport does not support thinking effort "${thinkingEffort}".`
    )
  }

  return { thinkingLevel }
}

export function isGoogleChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return isChatCandidate(normalizedModelId) && normalizedModelId.startsWith("gemini-")
}
