import { useCallback, useEffect, useState } from "react"
import {
  MenuBarExtra,
  openExternal,
  useInterval,
  useNativeExtensionNavigation
} from "@openwork/extension-api"
import {
  listUnreadGitHubNotifications,
  markAllUnreadGitHubNotificationsAsRead,
  markUnreadGitHubNotificationAsRead,
  openGitHubSettings,
  type GitHubNotification,
  useGitHubCommandPreferences
} from "./runtime-client"

interface GitHubUnreadNotificationPreferences {
  refreshIntervalSeconds?: number | string
  showUnreadCount?: boolean
}

function normalizeRefreshIntervalSeconds(value: number | string | undefined): number {
  const numericValue = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(numericValue)) {
    return 60
  }

  return Math.max(15, Math.min(3600, numericValue))
}

export default function GitHubUnreadNotifications(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const commandPreferences = useGitHubCommandPreferences<GitHubUnreadNotificationPreferences>()
  const refreshIntervalSeconds = normalizeRefreshIntervalSeconds(
    commandPreferences.refreshIntervalSeconds
  )
  const [items, setItems] = useState<GitHubNotification[]>([])
  const [isConfigured, setIsConfigured] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setRefreshError(null)

    try {
      const response = await listUnreadGitHubNotifications()
      if (signal?.aborted) {
        return
      }

      setIsConfigured(response.configured)
      setItems(response.notifications)
    } catch (error) {
      if (signal?.aborted) {
        return
      }

      console.error("[GitHub] Failed to refresh menu bar notifications", error)
      setRefreshError(
        error instanceof Error ? error.message : "Failed to refresh GitHub notifications"
      )
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)

    return () => {
      controller.abort()
    }
  }, [refresh])

  useInterval(refresh, refreshIntervalSeconds * 1000)

  if (!isConfigured) {
    return (
      <MenuBarExtra
        icon="assets/notifications.png"
        title="GitHub"
        tooltip="Configure GitHub to enable menu bar notifications"
      >
        <MenuBarExtra.Section title="GitHub">
          <MenuBarExtra.Item
            iconName="gear"
            title="Configure GitHub"
            onAction={() => void openGitHubSettings("unread-notifications")}
          />
        </MenuBarExtra.Section>
      </MenuBarExtra>
    )
  }

  return (
    <MenuBarExtra
      icon="assets/notifications.png"
      isLoading={isLoading}
      title={
        commandPreferences.showUnreadCount === false
          ? "GitHub"
          : items.length
            ? String(items.length)
            : "GitHub"
      }
      tooltip="Unread GitHub notifications"
    >
      <MenuBarExtra.Section title="Unread Notifications">
        {refreshError ? (
          <MenuBarExtra.Item
            disabled
            iconName="refresh"
            subtitle={refreshError}
            title="Refresh failed"
            onAction={() => {}}
          />
        ) : items.length > 0 ? (
          items.map((notification) => (
            <MenuBarExtra.Item
              key={notification.id}
              iconName="bell"
              subtitle={notification.repositoryFullName}
              title={notification.title}
              onAction={() => {
                void markUnreadGitHubNotificationAsRead({
                  notificationId: notification.id
                })
                  .then(() => {
                    void openExternal(notification.url)
                    setItems((current) => current.filter((item) => item.id !== notification.id))
                  })
                  .catch((error) => {
                    console.error(
                      "[GitHub] Failed to mark notification as read from menu bar",
                      error
                    )
                  })
              }}
            />
          ))
        ) : (
          <MenuBarExtra.Item
            disabled
            title={isLoading ? "Loading unread notifications…" : "No unread notifications"}
            onAction={() => {}}
          />
        )}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Actions">
        <MenuBarExtra.Item
          iconName="bell"
          title="Open Notifications Command"
          onAction={() => {
            void navigation.openCommand(
              {
                commandName: "notifications",
                extensionName: "github"
              },
              { showLauncher: true }
            )
          }}
        />
        <MenuBarExtra.Item
          iconName={items.length > 0 ? "check" : "bell"}
          title={items.length > 0 ? "Mark All as Read" : "Refresh"}
          onAction={() => {
            if (items.length > 0) {
              void markAllUnreadGitHubNotificationsAsRead()
                .then(() => {
                  setRefreshError(null)
                  setItems([])
                })
                .catch((error) => {
                  console.error(
                    "[GitHub] Failed to mark all notifications as read from menu bar",
                    error
                  )
                  setRefreshError(
                    error instanceof Error
                      ? error.message
                      : "Failed to mark GitHub notifications as read"
                  )
                })
              return
            }

            void refresh()
          }}
        />
        <MenuBarExtra.Item
          iconName="gear"
          title="Open GitHub Settings"
          onAction={() => void openGitHubSettings("unread-notifications")}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  )
}
