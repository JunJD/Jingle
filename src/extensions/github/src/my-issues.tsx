import { AlertCircle, CircleDotDashed, MessageSquare, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { Action, ActionPanel, List, useNativeCommandPreferences } from "../../api"

interface MyIssuesCommandPreferences {
  accessToken: string
  apiBaseUrl: string
  showAssigned: boolean
  showCreated: boolean
  showMentioned: boolean
  showRecentlyClosed: boolean
}

interface GitHubIssue {
  comments: number
  id: number
  number: number
  repositoryName: string
  state: "closed" | "open"
  title: string
  updatedAt: string
  url: string
}

interface GitHubIssueSection {
  id: string
  issues: GitHubIssue[]
  title: string
}

interface GitHubSearchResponse {
  items?: Array<{
    comments?: number
    html_url?: string
    id?: number
    number?: number
    repository_url?: string
    state?: "closed" | "open"
    title?: string
    updated_at?: string
  }>
  message?: string
}

interface GitHubSearchIssueItem {
  comments?: number
  html_url: string
  id: number
  number: number
  repository_url?: string
  state: "closed" | "open"
  title: string
  updated_at: string
}

const SECTION_LABELS = {
  assigned: "Assigned",
  created: "Created",
  mentioned: "Mentioned",
  recentlyClosed: "Recently Closed"
} as const

export const viewport = {
  bodyHeight: 520
}

function normalizeGitHubApiBaseUrl(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return "https://api.github.com"
  }

  return trimmed.replace(/\/+$/, "")
}

function parseRepositoryName(repositoryApiUrl?: string): string {
  if (!repositoryApiUrl) {
    return "Unknown Repository"
  }

  const match = repositoryApiUrl.match(/\/repos\/(.+)$/)
  return match?.[1] ?? repositoryApiUrl
}

function formatIssueCount(count: number): string {
  return count === 1 ? "1 issue" : `${count} issues`
}

function formatUpdatedAt(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) {
    return ""
  }

  return `Updated ${parsed.toLocaleString()}`
}

function isGitHubSearchIssueItem(
  item: NonNullable<GitHubSearchResponse["items"]>[number] | undefined
): item is GitHubSearchIssueItem {
  return (
    typeof item?.id === "number" &&
    typeof item.number === "number" &&
    typeof item.title === "string" &&
    typeof item.html_url === "string" &&
    typeof item.updated_at === "string" &&
    (item.state === "open" || item.state === "closed")
  )
}

function dedupeIssues(issues: GitHubIssue[]): GitHubIssue[] {
  const byId = new Map<number, GitHubIssue>()

  for (const issue of issues) {
    if (!byId.has(issue.id)) {
      byId.set(issue.id, issue)
    }
  }

  return Array.from(byId.values())
}

async function searchIssues(params: {
  accessToken: string
  apiBaseUrl: string
  query: string
}): Promise<GitHubIssue[]> {
  const response = await fetch(
    `${params.apiBaseUrl}/search/issues?q=${encodeURIComponent(params.query)}&per_page=20&sort=updated&order=desc`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${params.accessToken}`
      }
    }
  )

  const payload = (await response.json()) as GitHubSearchResponse
  if (!response.ok) {
    throw new Error(payload.message || `GitHub request failed with ${response.status}`)
  }

  return (payload.items ?? []).filter(isGitHubSearchIssueItem).map((item) => ({
    comments: item.comments ?? 0,
    id: item.id,
    number: item.number,
    repositoryName: parseRepositoryName(item.repository_url),
    state: item.state,
    title: item.title,
    updatedAt: item.updated_at,
    url: item.html_url
  }))
}

async function loadMyIssueSections(params: {
  accessToken: string
  apiBaseUrl: string
  preferences: Required<MyIssuesCommandPreferences>
}): Promise<GitHubIssueSection[]> {
  const queryEntries: Array<{
    key: keyof typeof SECTION_LABELS
    query: string
  }> = []

  if (params.preferences.showCreated) {
    queryEntries.push({
      key: "created",
      query: "is:issue author:@me archived:false is:open"
    })
  }

  if (params.preferences.showAssigned) {
    queryEntries.push({
      key: "assigned",
      query: "is:issue assignee:@me archived:false is:open"
    })
  }

  if (params.preferences.showMentioned) {
    queryEntries.push({
      key: "mentioned",
      query: "is:issue mentions:@me archived:false is:open"
    })
  }

  const sections = await Promise.all(
    queryEntries.map(async (entry) => ({
      id: entry.key,
      issues: await searchIssues({
        accessToken: params.accessToken,
        apiBaseUrl: params.apiBaseUrl,
        query: entry.query
      }),
      title: SECTION_LABELS[entry.key]
    }))
  )

  if (!params.preferences.showRecentlyClosed) {
    return sections.filter((section) => section.issues.length > 0)
  }

  const recentlyClosed = dedupeIssues(
    (
      await Promise.all(
        ["author:@me", "assignee:@me", "mentions:@me"].map((qualifier) =>
          searchIssues({
            accessToken: params.accessToken,
            apiBaseUrl: params.apiBaseUrl,
            query: `is:issue ${qualifier} archived:false is:closed`
          })
        )
      )
    ).flat()
  )

  return [
    ...sections.filter((section) => section.issues.length > 0),
    ...(recentlyClosed.length > 0
      ? [
          {
            id: "recentlyClosed",
            issues: recentlyClosed,
            title: SECTION_LABELS.recentlyClosed
          }
        ]
      : [])
  ]
}

export default function GitHubMyIssues(): React.JSX.Element {
  const commandPreferences = useNativeCommandPreferences<MyIssuesCommandPreferences>()
  const [sections, setSections] = useState<GitHubIssueSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    const accessToken = commandPreferences.accessToken.trim()
    const apiBaseUrl = normalizeGitHubApiBaseUrl(commandPreferences.apiBaseUrl)

    if (!accessToken) {
      setSections([])
      setError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    void loadMyIssueSections({
      accessToken,
      apiBaseUrl,
      preferences: commandPreferences
    })
      .then((nextSections) => {
        if (!cancelled) {
          setSections(nextSections)
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setSections([])
          setError(nextError instanceof Error ? nextError.message : "Failed to load GitHub issues")
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
  }, [commandPreferences, reloadVersion])

  const accessToken = commandPreferences.accessToken.trim()

  const openGitHubSettings = (): Promise<void> => {
    return window.api.settings.openTab({
      tab: "extensions",
      target: {
        commandName: "my-issues",
        extensionName: "github"
      }
    })
  }

  return (
    <List
      actions={
        <ActionPanel>
          <Action
            icon={<RefreshCw className="h-4 w-4" />}
            onAction={() => setReloadVersion((value) => value + 1)}
            title="Refresh Issues"
          />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings()}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="GitHub"
      searchBarPlaceholder="Filter by title, repository, or issue number"
    >
      {!accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings()}
                title="Add GitHub Token"
              />
            </ActionPanel>
          }
          description="GitHub needs a personal access token before it can load your issues."
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
                onAction={() => void openGitHubSettings()}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
          title="GitHub Request Failed"
        />
      ) : sections.length === 0 && !isLoading ? (
        <List.EmptyView title="No issues found" />
      ) : null}

      {sections.map((section) => (
        <List.Section
          key={section.id}
          subtitle={formatIssueCount(section.issues.length)}
          title={section.title}
        >
          {section.issues.map((issue) => (
            <List.Item
              key={issue.id}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open Issue in Browser" url={issue.url} />
                </ActionPanel>
              }
              accessories={
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{issue.repositoryName}</span>
                  {issue.comments > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {issue.comments}
                    </span>
                  ) : null}
                </div>
              }
              icon={
                issue.state === "closed" ? (
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <CircleDotDashed className="h-4 w-4 text-emerald-500" />
                )
              }
              keywords={[String(issue.number), issue.repositoryName, issue.state]}
              subtitle={formatUpdatedAt(issue.updatedAt)}
              title={`${issue.title} · #${issue.number}`}
            />
          ))}
        </List.Section>
      ))}
    </List>
  )
}
