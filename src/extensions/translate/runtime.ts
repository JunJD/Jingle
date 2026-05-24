import { defineNativeExtensionRuntime } from "../runtime-api"
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
