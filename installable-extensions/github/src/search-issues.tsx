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

const EMPTY_ISSUES: GitHubIssueLike[] = []

function buildIssueSearchQuery(searchText: string): string {
  const trimmed = searchText.trim()
  if (!trimmed) {
    return "is:issue archived:false sort:updated-desc"
  }

  return `is:issue archived:false ${trimmed}`
}

export default function GitHubSearchIssues(): React.JSX.Element {
  const githubPreferences = useGitHubPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(githubPreferences),
    [githubPreferences]
  )
  const [searchText, setSearchText] = useState(resolvedPreferences.defaultSearchTerms)
  const deferredSearchText = useDeferredValue(searchText)
  const loadIssues = useCallback(async () => {
    const nextItems = await searchGitHubIssueLikes({
      preferences: resolvedPreferences,
      query: buildIssueSearchQuery(deferredSearchText)
    })
    return nextItems.filter((item) => item.kind === "issue")
  }, [deferredSearchText, resolvedPreferences])
  const {
    data: items,
    error,
    isLoading,
    refresh
  } = useRefreshableData({
    emptyData: EMPTY_ISSUES,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to search GitHub issues",
    load: loadIssues
  })

  return (
    <List
      actions={
        <ActionPanel>
          <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Refresh" />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("search-issues")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="Search Issues"
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Globally search issues across repositories"
      searchText={searchText}
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("search-issues")}
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
                onAction={() => void openGitHubSettings("search-issues")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : items.length === 0 && !isLoading ? (
        <List.EmptyView title="No issues found" />
      ) : null}

      {items.length > 0 ? (
        <List.Section
          subtitle={formatResultCount(items.length, "issue")}
          title={deferredSearchText.trim() ? "Search Results" : "Recently Updated"}
        >
          {items.map((item) => (
            <List.Item
              key={item.id}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Issue in Browser" url={item.url} />
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
