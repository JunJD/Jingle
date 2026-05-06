import { defineNativeExtensionRenderer } from "@shared/native-extensions"
import * as TranslateMeta from "./src/translate.meta"
import * as TranslateModule from "./src/translate"

export const translateRenderer = defineNativeExtensionRenderer({
  commands: [
    { commandModule: TranslateModule, metaModule: TranslateMeta, name: "translate" }
  ]
})
