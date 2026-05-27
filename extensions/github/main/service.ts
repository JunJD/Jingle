import {
  defineNativeExtensionService,
  type NativeExtensionInvokeContext
} from "@openwork/extension-api"
import {
  listGitHubNotifications,
  markAllGitHubNotificationsAsRead,
  markGitHubNotificationAsRead,
  normalizeGitHubPreferences,
  type GitHubExtensionPreferences
} from "../src/client-core"
import {
  GITHUB_EXTENSION_ID,
  GITHUB_RPC_METHOD_LIST_UNREAD_NOTIFICATIONS,
  GITHUB_RPC_METHOD_MARK_ALL_NOTIFICATIONS_AS_READ,
  GITHUB_RPC_METHOD_MARK_NOTIFICATION_AS_READ,
  type GitHubUnreadNotificationsResponse,
  type MarkGitHubNotificationAsReadRequest
} from "../src/contracts"

function resolveGitHubPreferences(
  context: NativeExtensionInvokeContext
): ReturnType<typeof normalizeGitHubPreferences> {
  const preferences = context.extensionPreferences

  return normalizeGitHubPreferences({
    accessToken: String(preferences.accessToken ?? ""),
    apiBaseUrl: String(preferences.apiBaseUrl ?? ""),
    defaultSearchTerms: String(preferences.defaultSearchTerms ?? ""),
    numberOfResults:
      typeof preferences.numberOfResults === "number"
        ? preferences.numberOfResults
        : String(preferences.numberOfResults ?? "")
  } satisfies GitHubExtensionPreferences)
}

async function listUnreadNotifications(
  _payload: Record<string, never>,
  context: NativeExtensionInvokeContext
): Promise<GitHubUnreadNotificationsResponse> {
  const preferences = resolveGitHubPreferences(context)
  if (!preferences.accessToken) {
    return {
      configured: false,
      notifications: []
    }
  }

  const notifications = await listGitHubNotifications({ preferences })
  return {
    configured: true,
    notifications: notifications.filter((notification) => notification.unread)
  }
}

async function markNotificationAsRead(
  payload: MarkGitHubNotificationAsReadRequest,
  context: NativeExtensionInvokeContext
): Promise<void> {
  const preferences = resolveGitHubPreferences(context)
  if (!preferences.accessToken) {
    throw new Error("GitHub is not configured.")
  }

  await markGitHubNotificationAsRead({
    notificationId: payload.notificationId,
    preferences
  })
}

async function markAllNotificationsAsRead(
  _payload: Record<string, never>,
  context: NativeExtensionInvokeContext
): Promise<void> {
  const preferences = resolveGitHubPreferences(context)
  if (!preferences.accessToken) {
    throw new Error("GitHub is not configured.")
  }

  await markAllGitHubNotificationsAsRead({ preferences })
}

const githubNativeExtensionService = defineNativeExtensionService(GITHUB_EXTENSION_ID, {
  [GITHUB_RPC_METHOD_LIST_UNREAD_NOTIFICATIONS]: listUnreadNotifications,
  [GITHUB_RPC_METHOD_MARK_ALL_NOTIFICATIONS_AS_READ]: markAllNotificationsAsRead,
  [GITHUB_RPC_METHOD_MARK_NOTIFICATION_AS_READ]: markNotificationAsRead
})

export default githubNativeExtensionService
