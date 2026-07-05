import { defineNativeExtensionMain } from "@jingle/extension-api"
import { createFigmaFilesTools } from "./main/tools"

// Generated migration preview. Add a native service if migrated commands need RPC handlers.
export const figmaFilesMain = defineNativeExtensionMain({
  tools: createFigmaFilesTools()
})
