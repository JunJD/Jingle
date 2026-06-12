import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"

export const translateRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: "translate",
      search: {
        aliases: ["translate", "yi"],
        keywords: ["translate", "translation", "翻译"]
      }
    }
  ],
  extensionName: "translate"
})
