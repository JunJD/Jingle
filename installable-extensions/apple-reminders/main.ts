import { defineNativeExtensionMain } from "@jingle/extension-api"
import appleRemindersNativeExtensionService from "./main/service"
import { createAppleRemindersTools } from "./main/tools"

export const appleRemindersMain = defineNativeExtensionMain({
  service: appleRemindersNativeExtensionService,
  tools: createAppleRemindersTools()
})
