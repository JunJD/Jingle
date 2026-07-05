import { AlertCircle, RefreshCw } from "lucide-react"
import { useCallback, useMemo } from "react"
import { Action, ActionPanel, List } from "@jingle/extension-api"
import {
  listGitHubStarredRepositories,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubRepository,
  useGitHubPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"
import { formatResultCount, formatUpdatedAt, getRepositoryAccessories } from "./view-helpers"

const EMPTY_REPOSITORIES: GitHubRepository[] = []

export default function GitHubMyStarredRepositories(): React.JSX.Element {
  const githubPreferences = useGitHubPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(githubPreferences),
    [githubPreferences]
  )
  const loadRepositories = useCallback(
    () =>
      listGitHubStarredRepositories({
        preferences: resolvedPreferences
      }),
    [resolvedPreferences]
  )
  const {
    data: items,
    error,
    isLoading,
    refresh
  } = useRefreshableData({
    emptyData: EMPTY_REPOSITORIES,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to load your starred GitHub repositories",
    load: loadRepositories
  })

  return (
    <List
      actions={
        <ActionPanel>
          <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Refresh" />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("my-starred-repositories")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="My Starred Repositories"
      searchBarPlaceholder="Filter starred repositories by name or language"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("my-starred-repositories")}
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
                onAction={() => void openGitHubSettings("my-starred-repositories")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : items.length === 0 && !isLoading ? (
        <List.EmptyView title="No starred repositories found" />
      ) : null}

      {items.length > 0 ? (
        <List.Section
          subtitle={formatResultCount(items.length, "repository")}
          title="My Starred Repositories"
        >
          {items.map((item) => (
            <List.Item
              key={item.id}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Repository in Browser" url={item.url} />
                </ActionPanel>
              }
              accessories={getRepositoryAccessories(item, true)}
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
