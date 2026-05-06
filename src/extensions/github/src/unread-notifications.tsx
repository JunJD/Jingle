import { useCallback, useEffect, useState } from "react"
import { MenuBarExtra, useBackgroundRefresh, useNativeExtensionNavigation } from "../../api"
import {
  listUnreadGitHubNotifications,
  markAllUnreadGitHubNotificationsAsRead,
  markUnreadGitHubNotificationAsRead,
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
  const refreshIntervalSeconds = normalizeRefreshIntervalSeconds(
    commandPreferences.refreshIntervalSeconds
  )
  const [items, setItems] = useState<GitHubNotification[]>([])
  const [isConfigured, setIsConfigured] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(() => {
    setIsLoading(true)
    return listUnreadGitHubNotifications()
      .then((response) => {
        setIsConfigured(response.configured)
        setItems(response.notifications)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [commandPreferences])

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      setIsLoading(true)
      try {
        const response = await listUnreadGitHubNotifications()
        if (!cancelled) {
          setIsConfigured(response.configured)
          setItems(response.notifications)
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
  }, [])

  useBackgroundRefresh(refresh, refreshIntervalSeconds * 1000)

  if (!isConfigured) {
    return (
      <MenuBarExtra
        iconName="github"
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
      iconName="github"
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
              iconName="bell"
              subtitle={notification.repositoryFullName}
              title={notification.title}
              onAction={() => {
                void markUnreadGitHubNotificationAsRead({
                  notificationId: notification.id
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
          iconName="bell"
          title="Open Notifications Command"
          onAction={() => {
            void window.api.launcher.show().then(() => {
              navigation.openCommand({
                commandName: "notifications",
                extensionName: "github",
                kind: "extension-command"
              })
            })
          }}
        />
        <MenuBarExtra.Item
          iconName={items.length > 0 ? "check" : "bell"}
          title={items.length > 0 ? "Mark All as Read" : "Refresh"}
          onAction={() => {
            if (items.length > 0) {
              void markAllUnreadGitHubNotificationsAsRead().then(() => {
                setItems([])
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
