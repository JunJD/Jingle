import { defineNativeExtensionMain } from "@shared/native-extensions"
import githubNativeExtensionService from "./main/service"
import { createGitHubTools } from "./main/tools"

export const githubMain = defineNativeExtensionMain({
  service: githubNativeExtensionService,
  tools: createGitHubTools()
})
