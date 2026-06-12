import { defineNativeExtensionMain } from "@openwork/extension-api"
import githubNativeExtensionService from "./main/service"
import { createGitHubTools } from "./main/tools"

export const githubMain = defineNativeExtensionMain({
  service: githubNativeExtensionService,
  tools: createGitHubTools()
})
