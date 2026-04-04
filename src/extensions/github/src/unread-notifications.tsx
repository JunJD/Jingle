import { useCallback, useEffect, useMemo, useState } from "react"
import { MenuBarExtra, useBackgroundRefresh, useNativeExtensionNavigation } from "../../api"
import {
  listGitHubNotifications,
  markAllGitHubNotificationsAsRead,
  markGitHubNotificationAsRead,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubNotification,
  useGitHubCommandPreferences
} from "./client"

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
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const refreshIntervalSeconds = normalizeRefreshIntervalSeconds(
    commandPreferences.refreshIntervalSeconds
  )
  const [items, setItems] = useState<GitHubNotification[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(() => {
    if (!resolvedPreferences.accessToken) {
      setItems([])
      return Promise.resolve()
    }

    setIsLoading(true)
    return listGitHubNotifications({
      preferences: resolvedPreferences
    })
      .then((nextItems) => {
        setItems(nextItems.filter((item) => item.unread))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [resolvedPreferences])

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      setIsLoading(true)
      try {
        const nextItems = await listGitHubNotifications({
          preferences: resolvedPreferences
        })
        if (!cancelled) {
          setItems(nextItems.filter((item) => item.unread))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [resolvedPreferences])

  useBackgroundRefresh(refresh, refreshIntervalSeconds * 1000)

  if (!resolvedPreferences.accessToken) {
    return (
      <MenuBarExtra title="GitHub" tooltip="Configure GitHub to enable menu bar notifications">
        <MenuBarExtra.Section title="GitHub">
          <MenuBarExtra.Item
            title="Configure GitHub"
            onAction={() => void openGitHubSettings("unread-notifications")}
          />
        </MenuBarExtra.Section>
      </MenuBarExtra>
    )
  }

  return (
    <MenuBarExtra
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
        {items.length > 0 ? (
          items.map((notification) => (
            <MenuBarExtra.Item
              key={notification.id}
              subtitle={notification.repositoryFullName}
              title={notification.title}
              onAction={() => {
                void markGitHubNotificationAsRead({
                  notificationId: notification.id,
                  preferences: resolvedPreferences
                })
                  .then(() => {
                    window.open(notification.url, "_blank", "noopener,noreferrer")
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
          title="Open Notifications Command"
          onAction={() => {
            void window.api.launcher.show().then(() => {
              navigation.openCommand({
                commandName: "notifications",
                kind: "internal-plugin",
                pluginId: "github"
              })
            })
          }}
        />
        <MenuBarExtra.Item
          title={items.length > 0 ? "Mark All as Read" : "Refresh"}
          onAction={() => {
            if (items.length > 0) {
              void markAllGitHubNotificationsAsRead({
                preferences: resolvedPreferences
              }).then(() => {
                setItems([])
              })
              return
            }

            void refresh()
          }}
        />
        <MenuBarExtra.Item
          title="Open GitHub Settings"
          onAction={() => void openGitHubSettings("unread-notifications")}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  )
}
