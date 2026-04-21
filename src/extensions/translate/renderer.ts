import { defineNativeExtensionRenderer } from "@shared/native-extensions"
import * as TranslateMeta from "./src/translate.meta"
import * as TranslateModule from "./src/translate"
import * as TranslateQuickCopyModule from "./src/translate-quick-copy"

export const translateRenderer = defineNativeExtensionRenderer({
  commands: [
    { commandModule: TranslateModule, metaModule: TranslateMeta, name: "translate" },
    { commandModule: TranslateQuickCopyModule, name: "translate-quick-copy" }
  ]
})
