import { defineNativeExtensionMain } from "@shared/native-extensions"
import { createNotionTools } from "./main/tools"

export const notionMain = defineNativeExtensionMain({
  tools: createNotionTools()
})
