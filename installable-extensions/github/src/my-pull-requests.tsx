import { AlertCircle, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "@jingle/extension-api"
import {
  dedupeIssueLikes,
  loadGitHubViewer,
  openGitHubSettings,
  normalizeGitHubPreferences,
  searchGitHubIssueLikes,
  type GitHubIssueLike,
  type GitHubPullRequestListPreferences,
  useGitHubPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"
import {
  formatResultCount,
  formatUpdatedAt,
  getIssueLikeAccessories,
  getIssueLikeIcon
} from "./view-helpers"

const EMPTY_SECTIONS: GitHubPullRequestSection[] = []

interface GitHubPullRequestSection {
  id: string
  items: GitHubIssueLike[]
  title: string
}

const SECTION_LABELS = {
  assigned: "Assigned",
  authored: "Authored",
  mentioned: "Mentioned",
  recentlyClosed: "Recently Closed",
  reviewRequested: "Review Requested",
  reviewed: "Reviewed"
} as const

function buildPullRequestQuery(
  base: string,
  includeDrafts: boolean,
  state: "open" | "closed"
): string {
  return `is:pr ${base} archived:false is:${state} ${includeDrafts ? "" : "draft:false"}`.trim()
}

async function loadMyPullRequestSections(params: {
  commandPreferences: GitHubPullRequestListPreferences
  preferences: ReturnType<typeof normalizeGitHubPreferences>
}): Promise<GitHubPullRequestSection[]> {
  const viewer = await loadGitHubViewer({ preferences: params.preferences })
  const queryEntries: Array<{ key: keyof typeof SECTION_LABELS; query: string }> = [
    {
      key: "authored",
      query: buildPullRequestQuery(
        `author:${viewer.login}`,
        params.commandPreferences.includeDrafts,
        "open"
      )
    }
  ]

  if (params.commandPreferences.includeAssigned) {
    queryEntries.push({
      key: "assigned",
      query: buildPullRequestQuery(
        `assignee:${viewer.login}`,
        params.commandPreferences.includeDrafts,
        "open"
      )
    })
  }

  if (params.commandPreferences.includeMentioned) {
    queryEntries.push({
      key: "mentioned",
      query: buildPullRequestQuery(
        `mentions:${viewer.login}`,
        params.commandPreferences.includeDrafts,
        "open"
      )
    })
  }

  if (params.commandPreferences.includeReviewRequests) {
    queryEntries.push({
      key: "reviewRequested",
      query: buildPullRequestQuery(
        `review-requested:${viewer.login}`,
        params.commandPreferences.includeDrafts,
        "open"
      )
    })
  }

  if (params.commandPreferences.includeReviewed) {
    queryEntries.push({
      key: "reviewed",
      query: buildPullRequestQuery(
        `reviewed-by:${viewer.login}`,
        params.commandPreferences.includeDrafts,
        "open"
      )
    })
  }

  const sections = await Promise.all(
    queryEntries.map(async (entry) => ({
      id: entry.key,
      items: await searchGitHubIssueLikes({
        preferences: params.preferences,
        query: entry.query
      }),
      title: SECTION_LABELS[entry.key]
    }))
  )

  if (!params.commandPreferences.includeRecentlyClosed) {
    return sections.filter((section) => section.items.length > 0)
  }

  const recentlyClosedGroups = await Promise.all(
    [`author:${viewer.login}`, `assignee:${viewer.login}`, `review-requested:${viewer.login}`].map(
      (qualifier) =>
        searchGitHubIssueLikes({
          preferences: params.preferences,
          query: buildPullRequestQuery(qualifier, params.commandPreferences.includeDrafts, "closed")
        })
    )
  )

  const recentlyClosed = dedupeIssueLikes(recentlyClosedGroups.flat())

  return [
    ...sections.filter((section) => section.items.length > 0),
    ...(recentlyClosed.length > 0
      ? [{ id: "recentlyClosed", items: recentlyClosed, title: SECTION_LABELS.recentlyClosed }]
      : [])
  ]
}

export default function GitHubMyPullRequests(): React.JSX.Element {
  const commandPreferences = useGitHubPreferences<GitHubPullRequestListPreferences>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [selectedRepository, setSelectedRepository] = useState("")
  const loadSections = useCallback(
    () =>
      loadMyPullRequestSections({
        commandPreferences,
        preferences: resolvedPreferences
      }),
    [commandPreferences, resolvedPreferences]
  )
  const {
    data: sections,
    error,
    isLoading,
    refresh
  } = useRefreshableData({
    emptyData: EMPTY_SECTIONS,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to load GitHub pull requests",
    load: loadSections
  })

  const repositoryOptions = useMemo(
    () =>
      Array.from(
        new Set(sections.flatMap((section) => section.items.map((item) => item.repositoryName)))
      ).sort((left, right) => left.localeCompare(right)),
    [sections]
  )

  const filteredSections = useMemo(() => {
    if (!selectedRepository) {
      return sections
    }

    const nextSections: GitHubPullRequestSection[] = []
    for (const section of sections) {
      const items = section.items.filter((item) => item.repositoryName === selectedRepository)
      if (items.length > 0) {
        nextSections.push({ ...section, items })
      }
    }

    return nextSections
  }, [sections, selectedRepository])

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

  return (
    <List
      actions={
        <ActionPanel>
          <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Refresh" />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("my-pull-requests")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="My Pull Requests"
      searchBarAccessory={searchBarAccessory}
      searchBarPlaceholder="Filter by title, repository, or pull request number"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("my-pull-requests")}
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
                onAction={() => void openGitHubSettings("my-pull-requests")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : filteredSections.length === 0 && !isLoading ? (
        <List.EmptyView title="No pull requests found" />
      ) : null}

      {filteredSections.map((section) => (
        <List.Section
          key={section.id}
          subtitle={formatResultCount(section.items.length, "pull request")}
          title={section.title}
        >
          {section.items.map((item) => (
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
      ))}
    </List>
  )
}
