import { openNativeExtensionSettings, useNativeCommandPreferences } from "../../runtime-api"
import type { GitHubExtensionPreferences } from "./client-core"

export * from "./client-core"

export function useGitHubCommandPreferences<T extends object>() {
  return useNativeCommandPreferences<GitHubExtensionPreferences & T>()
}

export function openGitHubSettings(commandName: string): Promise<void> {
  return openNativeExtensionSettings({
    commandName,
    extensionName: "github"
  })
}
