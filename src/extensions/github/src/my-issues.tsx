import { AlertCircle, RefreshCw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "../../api"
import {
  dedupeIssueLikes,
  openGitHubSettings,
  normalizeGitHubPreferences,
  searchGitHubIssueLikes,
  type GitHubIssueListPreferences,
  type GitHubIssueLike,
  useGitHubCommandPreferences
} from "./client"
import {
  formatResultCount,
  formatUpdatedAt,
  getIssueLikeAccessories,
  getIssueLikeIcon
} from "./view-helpers"

interface GitHubIssueSection {
  id: string
  items: GitHubIssueLike[]
  title: string
}

const SECTION_LABELS = {
  assigned: "Assigned",
  created: "Created",
  mentioned: "Mentioned",
  recentlyClosed: "Recently Closed"
} as const

async function loadMyIssueSections(params: {
  preferences: ReturnType<typeof normalizeGitHubPreferences>
  commandPreferences: GitHubIssueListPreferences
}): Promise<GitHubIssueSection[]> {
  const queryEntries: Array<{ key: keyof typeof SECTION_LABELS; query: string }> = []

  if (params.commandPreferences.showCreated) {
    queryEntries.push({
      key: "created",
      query: "is:issue author:@me archived:false is:open"
    })
  }

  if (params.commandPreferences.showAssigned) {
    queryEntries.push({
      key: "assigned",
      query: "is:issue assignee:@me archived:false is:open"
    })
  }

  if (params.commandPreferences.showMentioned) {
    queryEntries.push({
      key: "mentioned",
      query: "is:issue mentions:@me archived:false is:open"
    })
  }

  const sections: GitHubIssueSection[] = []

  for (const entry of queryEntries) {
    sections.push({
      id: entry.key,
      items: await searchGitHubIssueLikes({
        preferences: params.preferences,
        query: entry.query
      }),
      title: SECTION_LABELS[entry.key]
    })
  }

  if (!params.commandPreferences.showRecentlyClosed) {
    return sections.filter((section) => section.items.length > 0)
  }

  const recentlyClosedGroups: GitHubIssueLike[][] = []

  for (const qualifier of ["author:@me", "assignee:@me", "mentions:@me"]) {
    recentlyClosedGroups.push(
      await searchGitHubIssueLikes({
        preferences: params.preferences,
        query: `is:issue ${qualifier} archived:false is:closed`
      })
    )
  }

  const recentlyClosed = dedupeIssueLikes(recentlyClosedGroups.flat())

  return [
    ...sections.filter((section) => section.items.length > 0),
    ...(recentlyClosed.length > 0
      ? [{ id: "recentlyClosed", items: recentlyClosed, title: SECTION_LABELS.recentlyClosed }]
      : [])
  ]
}

export default function GitHubMyIssues(): React.JSX.Element {
  const commandPreferences = useGitHubCommandPreferences<GitHubIssueListPreferences>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [sections, setSections] = useState<GitHubIssueSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [selectedRepository, setSelectedRepository] = useState("")

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const nextSections = await loadMyIssueSections({
          commandPreferences,
          preferences: resolvedPreferences
        })
        if (!cancelled) {
          setSections(nextSections)
        }
      } catch (nextError) {
        if (!cancelled) {
          setSections([])
          setError(nextError instanceof Error ? nextError.message : "Failed to load GitHub issues")
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
  }, [commandPreferences, reloadVersion, resolvedPreferences])

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

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.repositoryName === selectedRepository)
      }))
      .filter((section) => section.items.length > 0)
  }, [sections, selectedRepository])

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
            onAction={() => void openGitHubSettings("my-issues")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="My Issues"
      searchBarAccessory={
        repositoryOptions.length > 0 ? (
          <List.Dropdown onChange={setSelectedRepository} value={selectedRepository}>
            <List.Dropdown.Section title="Repository">
              <List.Dropdown.Item title="All Repositories" value="" />
              {repositoryOptions.map((repository) => (
                <List.Dropdown.Item key={repository} title={repository} value={repository} />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : null
      }
      searchBarPlaceholder="Filter by title, repository, or issue number"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("my-issues")}
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
                onAction={() => void openGitHubSettings("my-issues")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : filteredSections.length === 0 && !isLoading ? (
        <List.EmptyView title="No issues found" />
      ) : null}

      {filteredSections.map((section) => (
        <List.Section
          key={section.id}
          subtitle={formatResultCount(section.items.length, "issue")}
          title={section.title}
        >
          {section.items.map((item) => (
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
      ))}
    </List>
  )
}
