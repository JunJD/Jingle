import { defineNativeExtensionMain } from "@openwork/extension-api"
import { createNotionTools } from "./main/tools"

export const notionMain = defineNativeExtensionMain({
  tools: createNotionTools()
})
