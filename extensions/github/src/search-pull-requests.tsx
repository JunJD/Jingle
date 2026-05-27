import { AlertCircle, RefreshCw } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "@openwork/extension-api"
import {
  normalizeGitHubPreferences,
  openGitHubSettings,
  searchGitHubIssueLikes,
  type GitHubIssueLike,
  useGitHubCommandPreferences
} from "./runtime-client"
import {
  formatResultCount,
  formatUpdatedAt,
  getIssueLikeAccessories,
  getIssueLikeIcon
} from "./view-helpers"

function buildPullRequestSearchQuery(searchText: string): string {
  const trimmed = searchText.trim()
  if (!trimmed) {
    return "is:pr archived:false sort:updated-desc"
  }

  return `is:pr archived:false ${trimmed}`
}

export default function GitHubSearchPullRequests(): React.JSX.Element {
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
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const nextItems = await searchGitHubIssueLikes({
          preferences: resolvedPreferences,
          query: buildPullRequestSearchQuery(deferredSearchText)
        })
        if (!cancelled) {
          setItems(nextItems.filter((item) => item.kind === "pull_request"))
        }
      } catch (nextError) {
        if (!cancelled) {
          setItems([])
          setError(
            nextError instanceof Error ? nextError.message : "Failed to search GitHub pull requests"
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
