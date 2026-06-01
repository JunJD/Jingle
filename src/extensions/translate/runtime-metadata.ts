import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"
import { search } from "./src/translate.meta"

export const translateRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: "translate",
      search
    }
  ],
  extensionName: "translate"
})
