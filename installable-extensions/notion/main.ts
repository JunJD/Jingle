import { defineNativeExtensionMain } from "@jingle/extension-api"
import { createNotionTools } from "./main/tools"

export const notionMain = defineNativeExtensionMain({
  tools: createNotionTools()
})
