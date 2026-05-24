import { defineNativeExtensionRuntimeMetadata } from "../runtime-metadata-contract"
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
