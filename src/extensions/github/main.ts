import { defineNativeExtensionMain } from "@shared/native-extensions"
import githubNativeExtensionService from "./main/service"

export const githubMain = defineNativeExtensionMain({
  service: githubNativeExtensionService
})
