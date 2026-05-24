import { AlertCircle, RefreshCw } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "../../runtime-api"
import {
  loadGitHubViewer,
  normalizeGitHubPreferences,
  openGitHubSettings,
  searchGitHubRepositories,
  type GitHubRepository,
  type GitHubSearchRepositoriesPreferences,
  type GitHubViewer,
  useGitHubCommandPreferences
} from "./runtime-client"
import { formatResultCount, formatUpdatedAt, getRepositoryAccessories } from "./view-helpers"

function buildRepositorySearchQuery(params: {
  includeArchived: boolean
  includeForks: boolean
  scope: string
  searchText: string
}): string {
  const parts = [params.scope, params.searchText.trim(), params.includeForks ? "" : "fork:false"]

  if (!params.includeArchived) {
    parts.push("archived:false")
  }

  return (
    parts
      .filter((part) => part.trim().length > 0)
      .join(" ")
      .trim() || "stars:>0 archived:false"
  )
}

function getScopeOptions(viewer: GitHubViewer | null): Array<{ title: string; value: string }> {
  if (!viewer) {
    return [{ title: "All Repositories", value: "" }]
  }

  return [
    { title: "All Repositories", value: "" },
    { title: "My Repositories", value: `user:${viewer.login}` }
  ]
}

export default function GitHubSearchRepositories(): React.JSX.Element {
  const commandPreferences = useGitHubCommandPreferences<GitHubSearchRepositoriesPreferences>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [items, setItems] = useState<GitHubRepository[]>([])
  const [viewer, setViewer] = useState<GitHubViewer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [searchText, setSearchText] = useState(commandPreferences.defaultSearchTerms)
  const [scope, setScope] = useState("")
  const deferredSearchText = useDeferredValue(searchText)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      try {
        const nextViewer = await loadGitHubViewer({ preferences: resolvedPreferences })
        if (!cancelled) {
          setViewer(nextViewer)
        }
      } catch {
        if (!cancelled) {
          setViewer(null)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [resolvedPreferences])

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const nextItems = await searchGitHubRepositories({
          preferences: resolvedPreferences,
          query: buildRepositorySearchQuery({
            includeArchived: commandPreferences.includeArchived,
            includeForks: commandPreferences.includeForks,
            scope,
            searchText: deferredSearchText
          })
        })
        if (!cancelled) {
          setItems(nextItems)
        }
      } catch (nextError) {
        if (!cancelled) {
          setItems([])
          setError(
            nextError instanceof Error ? nextError.message : "Failed to search GitHub repositories"
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
  }, [
    commandPreferences.includeArchived,
    commandPreferences.includeForks,
    deferredSearchText,
    reloadVersion,
    resolvedPreferences,
    scope
  ])

  const scopeOptions = useMemo(
    () => getScopeOptions(resolvedPreferences.accessToken ? viewer : null),
    [resolvedPreferences.accessToken, viewer]
  )

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
            onAction={() => void openGitHubSettings("search-repositories")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="Search Repositories"
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown onChange={setScope} value={scope}>
          <List.Dropdown.Section title="Scope">
            {scopeOptions.map((option) => (
              <List.Dropdown.Item key={option.value} title={option.title} value={option.value} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
      searchBarPlaceholder="Search in public and private repositories"
      searchText={searchText}
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("search-repositories")}
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
                onAction={() => void openGitHubSettings("search-repositories")}
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
          title={deferredSearchText.trim() ? "Search Results" : "Found Repositories"}
        >
          {items.map((item) => (
            <List.Item
              key={item.id}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Repository in Browser" url={item.url} />
                </ActionPanel>
              }
              accessories={getRepositoryAccessories(item, commandPreferences.displayOwnerName)}
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
