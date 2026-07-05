import { AlertCircle, RefreshCw } from "lucide-react"
import { useCallback, useDeferredValue, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "@jingle/extension-api"
import {
  normalizeGitHubPreferences,
  openGitHubSettings,
  searchGitHubIssueLikes,
  type GitHubIssueLike,
  useGitHubPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"
import {
  formatResultCount,
  formatUpdatedAt,
  getIssueLikeAccessories,
  getIssueLikeIcon
} from "./view-helpers"

const EMPTY_PULL_REQUESTS: GitHubIssueLike[] = []

function buildPullRequestSearchQuery(searchText: string): string {
  const trimmed = searchText.trim()
  if (!trimmed) {
    return "is:pr archived:false sort:updated-desc"
  }

  return `is:pr archived:false ${trimmed}`
}

export default function GitHubSearchPullRequests(): React.JSX.Element {
  const githubPreferences = useGitHubPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(githubPreferences),
    [githubPreferences]
  )
  const [searchText, setSearchText] = useState(resolvedPreferences.defaultSearchTerms)
  const deferredSearchText = useDeferredValue(searchText)
  const loadPullRequests = useCallback(async () => {
    const nextItems = await searchGitHubIssueLikes({
      preferences: resolvedPreferences,
      query: buildPullRequestSearchQuery(deferredSearchText)
    })
    return nextItems.filter((item) => item.kind === "pull_request")
  }, [deferredSearchText, resolvedPreferences])
  const {
    data: items,
    error,
    isLoading,
    refresh
  } = useRefreshableData({
    emptyData: EMPTY_PULL_REQUESTS,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to search GitHub pull requests",
    load: loadPullRequests
  })

  return (
    <List
      actions={
        <ActionPanel>
          <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Refresh" />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("search-pull-requests")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="Search Pull Requests"
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Globally search pull requests"
      searchText={searchText}
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("search-pull-requests")}
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
                onAction={() => void openGitHubSettings("search-pull-requests")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : items.length === 0 && !isLoading ? (
        <List.EmptyView title="No pull requests found" />
      ) : null}

      {items.length > 0 ? (
        <List.Section
          subtitle={formatResultCount(items.length, "pull request")}
          title={deferredSearchText.trim() ? "Search Results" : "Recently Updated"}
        >
          {items.map((item) => (
            <List.Item
              key={item.id}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Pull Request in Browser" url={item.url} />
                </ActionPanel>
              }
              accessories={getIssueLikeAccessories(item)}
              icon={getIssueLikeIcon(item)}
              keywords={[String(item.number), item.repositoryName, item.state, item.kind]}
              subtitle={formatUpdatedAt(item.updatedAt)}
              title={`${item.title} · #${item.number}`}
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  )
}
