import { defineNativeExtensionMain } from "@openwork/extension-api"
import appleRemindersNativeExtensionService from "./main/service"
import { createAppleRemindersTools } from "./main/tools"

export const appleRemindersMain = defineNativeExtensionMain({
  service: appleRemindersNativeExtensionService,
  tools: createAppleRemindersTools()
})
