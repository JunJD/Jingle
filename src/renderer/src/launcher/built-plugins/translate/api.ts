import type {
  TranslateTextRequest,
  TranslateTextResponse
} from "../../../../../shared/built-plugins/translate"
import { createBuiltPluginClient, defineBuiltPluginClientMethod } from "../sdk"

export const translateBuiltPluginClient = createBuiltPluginClient("translate", {
  translate: defineBuiltPluginClientMethod<TranslateTextRequest, TranslateTextResponse>()
})
