import { AlertCircle, RefreshCw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "@openwork/extension-api"
import {
  listGitHubLatestRepositories,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubRepository,
  useGitHubCommandPreferences
} from "./runtime-client"
import { formatResultCount, formatUpdatedAt, getRepositoryAccessories } from "./view-helpers"

export default function GitHubMyLatestRepositories(): React.JSX.Element {
  const commandPreferences = useGitHubCommandPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [items, setItems] = useState<GitHubRepository[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const nextItems = await listGitHubLatestRepositories({
          preferences: resolvedPreferences
        })
        if (!cancelled) {
          setItems(nextItems)
        }
      } catch (nextError) {
        if (!cancelled) {
          setItems([])
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Failed to load your latest GitHub repositories"
          )
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
  }, [reloadVersion, resolvedPreferences])

  return (
    <List
      actions={
        <ActionPanel>
          <Action
            icon={<RefreshCw className="h-4 w-4" />}
            onAction={() => setReloadVersion((value) => value + 1)}
            title="Refresh"
          />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("my-latest-repositories")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="My Latest Repositories"
      searchBarPlaceholder="Filter repositories by name or language"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("my-latest-repositories")}
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
              <Action
                icon={<RefreshCw className="h-4 w-4" />}
                onAction={() => setReloadVersion((value) => value + 1)}
                title="Retry"
              />
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("my-latest-repositories")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : items.length === 0 && !isLoading ? (
        <List.EmptyView title="No repositories found" />
      ) : null}

      {items.length > 0 ? (
        <List.Section
          subtitle={formatResultCount(items.length, "repository")}
          title="My Latest Repositories"
        >
          {items.map((item) => (
            <List.Item
              key={item.id}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Repository in Browser" url={item.url} />
                </ActionPanel>
              }
              accessories={getRepositoryAccessories(item, false)}
              keywords={[
                item.fullName,
                item.ownerLogin,
                item.language ?? "",
                item.isArchived ? "archived" : "",
                item.isFork ? "fork" : ""
              ]}
              subtitle={item.description || formatUpdatedAt(item.updatedAt)}
              title={item.fullName}
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  )
}
