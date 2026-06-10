import { defineNativeExtensionMain } from "@openwork/extension-api"
import { createImageGenerationTools } from "./main/tools"

export const imageGenerationMain = defineNativeExtensionMain({
  tools: createImageGenerationTools()
})
