import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  DEFAULT_TRANSLATE_MODEL_ID,
  type TranslateBackendConfig,
  type TranslateTextRequest,
  type TranslateTextResponse
} from "../../../shared/built-plugins/translate"
import { getDefaultModel, getModelConfig } from "../../ipc/models"
import { getChatModelInstance } from "../../llm/get-chat-model"
import { hasApiKey } from "../../storage"
import { defineBuiltPluginService } from "./sdk"

const TRANSLATE_MODEL_FALLBACK_ORDER = [
  DEFAULT_TRANSLATE_MODEL_ID,
  "glm-4.6",
  "gemini-2.5-flash-lite",
  "gpt-4.1-mini",
  "claude-haiku-4-5-20251001"
]

function resolveBackend(backend?: TranslateBackendConfig): TranslateBackendConfig {
  const preferredModelId = resolvePreferredTranslateModelId(backend?.modelId)

  return {
    kind: "llm",
    modelId: preferredModelId
  }
}

function resolvePreferredTranslateModelId(requestedModelId?: string): string {
  const candidates = Array.from(
    new Set(
      [requestedModelId, getDefaultModel(), ...TRANSLATE_MODEL_FALLBACK_ORDER].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    )
  )

  for (const candidate of candidates) {
    const config = getModelConfig(candidate)
    if (!config) {
      continue
    }

    if (hasApiKey(config.provider)) {
      return candidate
    }
  }

  throw new Error("No available translation model. Configure at least one model provider API key.")
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
    modelId: backend.modelId ?? DEFAULT_TRANSLATE_MODEL_ID,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    translatedText
  }
}

export const translateBuiltPluginService = defineBuiltPluginService("translate", {
  translate: translateText
})
