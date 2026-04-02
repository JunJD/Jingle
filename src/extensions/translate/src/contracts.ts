export const TRANSLATE_EXTENSION_ID = "translate" as const
export const TRANSLATE_RPC_METHOD_TRANSLATE = "translate" as const
export const TRANSLATE_RPC_METHODS = [TRANSLATE_RPC_METHOD_TRANSLATE] as const

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
