import type {
  TranslateTextRequest,
  TranslateTextResponse
} from "../../../../../shared/built-plugins/translate"
import {
  TRANSLATE_LAUNCHER_PLUGIN_ID,
  TRANSLATE_RPC_METHODS,
  TRANSLATE_RPC_METHOD_TRANSLATE
} from "../../../../../plugins/translate/manifest"
import { createBuiltPluginClient, defineBuiltPluginClientMethod } from "../sdk"

export const translateBuiltPluginClient = createBuiltPluginClient(
  TRANSLATE_LAUNCHER_PLUGIN_ID,
  TRANSLATE_RPC_METHODS,
  {
    [TRANSLATE_RPC_METHOD_TRANSLATE]: defineBuiltPluginClientMethod<
      TranslateTextRequest,
      TranslateTextResponse
    >()
  }
)
