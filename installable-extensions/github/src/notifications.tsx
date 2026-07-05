import { AlertCircle, Bell, CheckCheck, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import {
  Action,
  ActionPanel,
  Detail,
  List,
  useNativeExtensionNavigation
} from "@jingle/extension-api"
import {
  listGitHubNotifications,
  markAllGitHubNotificationsAsRead,
  markGitHubNotificationAsRead,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubNotification,
  useGitHubPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"

const EMPTY_NOTIFICATIONS: GitHubNotification[] = []

function NotificationDetail(props: {
  notification: GitHubNotification
  onMarkAsRead: () => void
}): React.JSX.Element {
  const { notification, onMarkAsRead } = props
  const metadata = useMemo(
    () => (
      <Detail.Metadata>
        <Detail.Metadata.Label text={notification.repositoryFullName} title="Repository" />
        <Detail.Metadata.Label text={notification.reason} title="Reason" />
        <Detail.Metadata.Label text={notification.subjectType} title="Type" />
        <Detail.Metadata.Label text={notification.unread ? "Unread" : "Read"} title="Status" />
      </Detail.Metadata>
    ),
    [notification]
  )

  return (
    <Detail
      actions={
        <ActionPanel>
          {notification.unread ? (
            <Action
              icon={<CheckCheck className="h-4 w-4" />}
              onAction={onMarkAsRead}
              title="Mark as Read"
            />
          ) : null}
          <Action.OpenInBrowser title="Open Notification in Browser" url={notification.url} />
        </ActionPanel>
      }
      markdown={`# ${notification.title}\n\nThis notification belongs to **${notification.repositoryFullName}**.\n\nReason: **${notification.reason}**\n\nType: **${notification.subjectType}**\n\nLast updated: **${new Date(notification.updatedAt).toLocaleString()}**`}
      metadata={metadata}
      navigationTitle="Notification"
    />
  )
}

export default function GitHubNotifications(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const githubPreferences = useGitHubPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(githubPreferences),
    [githubPreferences]
  )
  const [selectedRepository, setSelectedRepository] = useState("")
  const loadNotifications = useCallback(
    () =>
      listGitHubNotifications({
        preferences: resolvedPreferences
      }),
    [resolvedPreferences]
  )
  const {
    data: items,
    error,
    isLoading,
    refresh,
    setData: setItems
  } = useRefreshableData({
    emptyData: EMPTY_NOTIFICATIONS,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to load GitHub notifications",
    load: loadNotifications
  })

  const repositoryOptions = useMemo(
    () =>
      Array.from(new Set(items.map((item) => item.repositoryFullName))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [items]
  )

  const filteredItems = useMemo(
    () =>
      selectedRepository
        ? items.filter((item) => item.repositoryFullName === selectedRepository)
        : items,
    [items, selectedRepository]
  )

  const unreadItems = filteredItems.filter((item) => item.unread)
  const readItems = filteredItems.filter((item) => !item.unread)

  const searchBarAccessory = useMemo(
    () =>
      repositoryOptions.length > 0 ? (
        <List.Dropdown onChange={setSelectedRepository} value={selectedRepository}>
          <List.Dropdown.Section title="Repository">
            <List.Dropdown.Item title="All Repositories" value="" />
            {repositoryOptions.map((repository) => (
              <List.Dropdown.Item key={repository} title={repository} value={repository} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      ) : null,
    [repositoryOptions, selectedRepository]
  )

  const markNotificationAsRead = (notificationId: string): void => {
    void markGitHubNotificationAsRead({
      notificationId,
      preferences: resolvedPreferences
    }).then(() => {
      setItems((current) =>
        current.map((item) =>
          item.id === notificationId
            ? {
                ...item,
                unread: false
              }
            : item
        )
      )
    })
  }

  return (
    <List
      actions={
        <ActionPanel>
          <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Refresh" />
          <Action
            icon={<CheckCheck className="h-4 w-4" />}
            onAction={() => {
              void markAllGitHubNotificationsAsRead({
                preferences: resolvedPreferences
              }).then(() => {
                setItems((current) => current.map((item) => ({ ...item, unread: false })))
              })
            }}
            title="Mark All as Read"
          />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("notifications")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="Notifications"
      searchBarAccessory={searchBarAccessory}
      searchBarPlaceholder="Filter notifications by title or repository"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("notifications")}
                title="Connect GitHub"
              />
            </ActionPanel>
          }
          description="GitHub needs to be connected before it can load this command."
          title="Connect GitHub"
        />
      ) : error ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Retry" />
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("notifications")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : filteredItems.length === 0 && !isLoading ? (
        <List.EmptyView title="No recent notifications found" />
      ) : null}

      {unreadItems.length > 0 ? (
        <List.Section title="Unread">
          {unreadItems.map((notification) => (
            <List.Item
              key={notification.id}
              actions={
                <ActionPanel>
                  <Action
                    icon={<Bell className="h-4 w-4" />}
                    onAction={() =>
                      navigation.push(
                        <NotificationDetail
                          notification={notification}
                          onMarkAsRead={() => markNotificationAsRead(notification.id)}
                        />
                      )
                    }
                    title="Show Notification Detail"
                  />
                  <Action
                    icon={<CheckCheck className="h-4 w-4" />}
                    onAction={() => markNotificationAsRead(notification.id)}
                    title="Mark as Read"
                  />
                  <Action.OpenInBrowser
                    title="Open Notification in Browser"
                    url={notification.url}
                  />
                </ActionPanel>
              }
              accessories={notification.repositoryFullName}
              icon={<Bell className="h-4 w-4 text-amber-500" />}
              keywords={[
                notification.repositoryFullName,
                notification.reason,
                notification.subjectType
              ]}
              subtitle={new Date(notification.updatedAt).toLocaleString()}
              title={notification.title}
            />
          ))}
        </List.Section>
      ) : null}

      {readItems.length > 0 ? (
        <List.Section title="Read">
          {readItems.map((notification) => (
            <List.Item
              key={notification.id}
              actions={
                <ActionPanel>
                  <Action
                    icon={<Bell className="h-4 w-4" />}
                    onAction={() =>
                      navigation.push(
                        <NotificationDetail
                          notification={notification}
                          onMarkAsRead={() => markNotificationAsRead(notification.id)}
                        />
                      )
                    }
                    title="Show Notification Detail"
                  />
                  <Action.OpenInBrowser
                    title="Open Notification in Browser"
                    url={notification.url}
                  />
                </ActionPanel>
              }
              accessories={notification.repositoryFullName}
              icon={<Bell className="h-4 w-4 text-muted-foreground" />}
              keywords={[
                notification.repositoryFullName,
                notification.reason,
                notification.subjectType
              ]}
              subtitle={new Date(notification.updatedAt).toLocaleString()}
              title={notification.title}
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  )
}
