import {
  createNativeExtensionClient,
  defineNativeExtensionClientMethod,
  openNativeExtensionSettings,
  useNativeCommandPreferences
} from "@openwork/extension-api"
import type { GitHubExtensionPreferences } from "./client-core"
import {
  GITHUB_EXTENSION_ID,
  GITHUB_RPC_METHODS,
  type GitHubUnreadNotificationsResponse,
  type MarkGitHubNotificationAsReadRequest
} from "./contracts"

export * from "./client-core"

export const githubRuntimeClient = createNativeExtensionClient(
  GITHUB_EXTENSION_ID,
  GITHUB_RPC_METHODS,
  {
    "list-unread-notifications": defineNativeExtensionClientMethod<
      Record<string, never>,
      GitHubUnreadNotificationsResponse
    >(),
    "mark-all-notifications-as-read": defineNativeExtensionClientMethod<
      Record<string, never>,
      void
    >(),
    "mark-notification-as-read": defineNativeExtensionClientMethod<
      MarkGitHubNotificationAsReadRequest,
      void
    >()
  }
)

export function useGitHubCommandPreferences<T extends object>() {
  return useNativeCommandPreferences<GitHubExtensionPreferences & T>()
}

export function openGitHubSettings(commandName: string): Promise<void> {
  return openNativeExtensionSettings({
    commandName,
    extensionName: "github"
  })
}

export function listUnreadGitHubNotifications(): Promise<GitHubUnreadNotificationsResponse> {
  return githubRuntimeClient["list-unread-notifications"]({})
}

export function markUnreadGitHubNotificationAsRead(
  payload: MarkGitHubNotificationAsReadRequest
): Promise<void> {
  return githubRuntimeClient["mark-notification-as-read"](payload)
}

export function markAllUnreadGitHubNotificationsAsRead(): Promise<void> {
  return githubRuntimeClient["mark-all-notifications-as-read"]({})
}
