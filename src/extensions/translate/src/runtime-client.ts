import { createNativeExtensionClient, defineNativeExtensionClientMethod } from "../../runtime-api"
import type { TranslateTextRequest, TranslateTextResponse } from "./contracts"
import { TRANSLATE_EXTENSION_ID, TRANSLATE_RPC_METHODS } from "./contracts"

export const translateRuntimeClient = createNativeExtensionClient(
  TRANSLATE_EXTENSION_ID,
  TRANSLATE_RPC_METHODS,
  {
    translate: defineNativeExtensionClientMethod<TranslateTextRequest, TranslateTextResponse>()
  }
)
