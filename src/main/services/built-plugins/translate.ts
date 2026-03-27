import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  type TranslateBackendConfig,
  type TranslateTextRequest,
  type TranslateTextResponse
} from "../../../shared/built-plugins/translate"
import { getModelConfig } from "../../ipc/models"
import { getChatModelInstance, inferProviderFromModelId } from "../../llm/get-chat-model"
import { getEnvValue, hasApiKey } from "../../storage"
import { getBuiltPluginSettings } from "../../preferences"
import { defineBuiltPluginService } from "./sdk"

const TRANSLATE_MODEL_ENV_NAME = "OPENWORK_TRANSLATE_MODEL_ID"
const TRANSLATE_MODEL_SETTINGS_PATH = "builtPluginSettings.translateModelId"

function resolveBackend(backend?: TranslateBackendConfig): TranslateBackendConfig {
  void backend

  return {
    kind: "llm",
    modelId: resolveConfiguredTranslateModelId()
  }
}

function resolveConfiguredTranslateModelId(): string {
  const configuredModelId =
    getBuiltPluginSettings().translateModelId ?? getEnvValue(TRANSLATE_MODEL_ENV_NAME)?.trim() ?? null
  if (!configuredModelId) {
    throw new Error(
      `Translation model is not configured. Set ${TRANSLATE_MODEL_SETTINGS_PATH} in ~/.openwork/settings.json or ${TRANSLATE_MODEL_ENV_NAME} in ~/.openwork/.env.`
    )
  }

  const provider =
    getModelConfig(configuredModelId)?.provider ?? inferProviderFromModelId(configuredModelId)
  if (!provider) {
    throw new Error(
      `Unknown translation model "${configuredModelId}". Check ${TRANSLATE_MODEL_SETTINGS_PATH} in ~/.openwork/settings.json or ${TRANSLATE_MODEL_ENV_NAME} in ~/.openwork/.env.`
    )
  }

  if (!hasApiKey(provider)) {
    throw new Error(`Translation provider "${provider}" is not configured.`)
  }

  return configuredModelId
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

  if (typeof model === "string") {
    throw new Error(`Model ${backend.modelId} does not support chat translation`)
  }

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

export const translateBuiltPluginService = defineBuiltPluginService("translate", {
  translate: translateText
})
