import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { parseProviderModelId } from "../../../main/model-provider/catalog"
import { getChatModelInstance } from "../../../main/llm/get-chat-model"
import { hasProviderApiKey } from "../../../main/model-provider/secrets"
import { defineNativeExtensionService } from "../../../main/services/native-extensions/sdk"
import { getEnvValue } from "../../../main/storage"
import type {
  TranslateBackendConfig,
  TranslateTextRequest,
  TranslateTextResponse
} from "../src/contracts"
import { TRANSLATE_EXTENSION_ID, TRANSLATE_RPC_METHOD_TRANSLATE } from "../src/contracts"

const TRANSLATE_MODEL_ENV_NAME = "OPENWORK_TRANSLATE_MODEL_ID"

function resolveBackend(backend?: TranslateBackendConfig): TranslateBackendConfig {
  const configuredModelId =
    backend?.modelId?.trim() ?? getEnvValue(TRANSLATE_MODEL_ENV_NAME)?.trim() ?? null

  if (!configuredModelId) {
    throw new Error(
      `Translation model is not configured. Set a provider-scoped model id, for example dashscope:glm-4.6, in the Translate Model command preference or ${TRANSLATE_MODEL_ENV_NAME}.`
    )
  }

  const { providerId } = parseProviderModelId(configuredModelId)

  if (!hasProviderApiKey(providerId)) {
    throw new Error(`Translation provider "${providerId}" is not configured.`)
  }

  return {
    kind: "llm",
    modelId: configuredModelId
  }
}

function buildTranslationPrompt(request: TranslateTextRequest): string {
  const sourceInstruction =
    request.sourceLanguage === "Auto Detect"
      ? "Detect the source language from the user's text."
      : `The source language is ${request.sourceLanguage}.`

  return [
    "You are a translation engine for a launcher plugin.",
    sourceInstruction,
    `Translate the user's text into ${request.targetLanguage}.`,
    "Preserve meaning, tone, formatting, markdown, bullet structure, and line breaks.",
    "Do not explain the translation.",
    "Do not add notes, headers, or quotation marks.",
    "Return only the translated text."
  ].join(" ")
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item
        }

        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text
        }

        return ""
      })
      .join("")
  }

  return ""
}

export async function translateText(request: TranslateTextRequest): Promise<TranslateTextResponse> {
  const backend = resolveBackend(request.backend)
  const model = getChatModelInstance({
    modelId: backend.modelId,
    temperature: 0
  })

  const response = await model.invoke([
    new SystemMessage(buildTranslationPrompt(request)),
    new HumanMessage(request.text)
  ])
  const translatedText = extractTextContent(response.content).trim()

  if (!translatedText) {
    throw new Error("Translation returned empty output")
  }

  return {
    backend,
    modelId: backend.modelId!,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    translatedText
  }
}

const translateNativeExtensionService = defineNativeExtensionService(TRANSLATE_EXTENSION_ID, {
  [TRANSLATE_RPC_METHOD_TRANSLATE]: translateText
})

export default translateNativeExtensionService
