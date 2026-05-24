import type { GitHubNotification } from "./client-core"

export const GITHUB_EXTENSION_ID = "github" as const

export const GITHUB_RPC_METHOD_LIST_UNREAD_NOTIFICATIONS = "list-unread-notifications" as const
export const GITHUB_RPC_METHOD_MARK_NOTIFICATION_AS_READ = "mark-notification-as-read" as const
export const GITHUB_RPC_METHOD_MARK_ALL_NOTIFICATIONS_AS_READ =
  "mark-all-notifications-as-read" as const

export const GITHUB_RPC_METHODS = [
  GITHUB_RPC_METHOD_LIST_UNREAD_NOTIFICATIONS,
  GITHUB_RPC_METHOD_MARK_NOTIFICATION_AS_READ,
  GITHUB_RPC_METHOD_MARK_ALL_NOTIFICATIONS_AS_READ
] as const

export interface GitHubUnreadNotificationsResponse {
  configured: boolean
  notifications: GitHubNotification[]
}

export interface MarkGitHubNotificationAsReadRequest {
  notificationId: string
}
