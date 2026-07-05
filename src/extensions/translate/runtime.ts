import { defineNativeExtensionRuntime } from "@jingle/extension-api"
import Translate from "./src/translate"

export const translateRuntime = defineNativeExtensionRuntime({
  commands: {
    translate: {
      Component: Translate,
      mode: "view"
    }
  },
  extensionName: "translate"
})
