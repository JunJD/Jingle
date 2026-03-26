export const DEFAULT_TRANSLATE_MODEL_ID = "qwen-plus"

export type TranslateBackendConfig = {
  kind: "llm"
  modelId?: string
}

export interface TranslateTextRequest {
  backend?: TranslateBackendConfig
  sourceLanguage: string
  targetLanguage: string
  text: string
}

export interface TranslateTextResponse {
  backend: TranslateBackendConfig
  modelId: string
  sourceLanguage: string
  targetLanguage: string
  translatedText: string
}
