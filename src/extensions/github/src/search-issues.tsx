import { AlertCircle, RefreshCw } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "../../api"
import {
  normalizeGitHubPreferences,
  openGitHubSettings,
  searchGitHubIssueLikes,
  type GitHubIssueLike,
  useGitHubCommandPreferences
} from "./client"
import { formatResultCount, formatUpdatedAt, getIssueLikeAccessories, getIssueLikeIcon } from "./view-helpers"

export const viewport = {
  bodyHeight: 520
}

function buildIssueSearchQuery(searchText: string): string {
  const trimmed = searchText.trim()
  if (!trimmed) {
    return "is:issue archived:false sort:updated-desc"
  }

  return `is:issue archived:false ${trimmed}`
}

export default function GitHubSearchIssues(): React.JSX.Element {
  const commandPreferences = useGitHubCommandPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [items, setItems] = useState<GitHubIssueLike[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [searchText, setSearchText] = useState(commandPreferences.defaultSearchTerms)
  const deferredSearchText = useDeferredValue(searchText)

  useEffect(() => {
    if (!resolvedPreferences.accessToken) {
      setItems([])
      setError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    void searchGitHubIssueLikes({
      preferences: resolvedPreferences,
      query: buildIssueSearchQuery(deferredSearchText)
    })
      .then((nextItems) => {
        if (!cancelled) {
          setItems(nextItems.filter((item) => item.kind === "issue"))
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setItems([])
          setError(nextError instanceof Error ? nextError.message : "Failed to search GitHub issues")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [deferredSearchText, reloadVersion, resolvedPreferences])

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
                title="Add GitHub Token"
              />
            </ActionPanel>
          }
          description="GitHub needs a personal access token before it can load this command."
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
