import { AlertCircle, Bot, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { Action, ActionPanel, List } from "@jingle/extension-api"
import {
  dedupeIssueLikes,
  loadGitHubViewer,
  openGitHubSettings,
  normalizeGitHubPreferences,
  searchGitHubIssueLikes,
  type GitHubIssueListPreferences,
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

const EMPTY_SECTIONS: GitHubIssueSection[] = []

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

function createRunBotAgentInput(item: GitHubIssueLike): Action.RunBotAgent["input"] {
  const issueLabel = `${item.repositoryName}#${item.number}`
  const sourceRef = {
    id: issueLabel,
    label: `GitHub ${item.kind === "pull_request" ? "pull request" : "issue"} ${issueLabel}`,
    metadata: {
      comments: item.comments,
      kind: item.kind,
      number: item.number,
      repositoryName: item.repositoryName,
      state: item.state,
      updatedAt: item.updatedAt
    },
    type: item.kind === "pull_request" ? "github.pull_request" : "github.issue",
    url: item.url
  }

  return {
    prompt: {
      contextRefs: [sourceRef],
      instructions: [
        "先阅读 GitHub 条目和相关代码，确认问题归属边界。",
        "给出最小可验证的实现或调查结论。",
        "完成后说明修改内容、验证方式和仍然存在的风险。"
      ],
      objective: `${item.kind === "pull_request" ? "处理 GitHub pull request" : "处理 GitHub issue"}：${item.title}`,
      skillRefs: ["github"]
    },
    sourceRef,
    title: `${item.repositoryName} #${item.number}: ${item.title}`,
    workflow: {
      labels: [
        { key: "source", value: "github" },
        { key: "repo", value: item.repositoryName },
        { key: "kind", value: item.kind === "pull_request" ? "pull-request" : "issue" }
      ],
      status: "ready"
    }
  }
}

async function loadMyIssueSections(params: {
  preferences: ReturnType<typeof normalizeGitHubPreferences>
  commandPreferences: GitHubIssueListPreferences
}): Promise<GitHubIssueSection[]> {
  const viewer = await loadGitHubViewer({ preferences: params.preferences })
  const queryEntries: Array<{ key: keyof typeof SECTION_LABELS; query: string }> = []

  if (params.commandPreferences.showCreated) {
    queryEntries.push({
      key: "created",
      query: `is:issue author:${viewer.login} archived:false is:open`
    })
  }

  if (params.commandPreferences.showAssigned) {
    queryEntries.push({
      key: "assigned",
      query: `is:issue assignee:${viewer.login} archived:false is:open`
    })
  }

  if (params.commandPreferences.showMentioned) {
    queryEntries.push({
      key: "mentioned",
      query: `is:issue mentions:${viewer.login} archived:false is:open`
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

  if (!params.commandPreferences.showRecentlyClosed) {
    return sections.filter((section) => section.items.length > 0)
  }

  const recentlyClosedGroups = await Promise.all(
    [`author:${viewer.login}`, `assignee:${viewer.login}`, `mentions:${viewer.login}`].map(
      (qualifier) =>
        searchGitHubIssueLikes({
          preferences: params.preferences,
          query: `is:issue ${qualifier} archived:false is:closed`
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

export default function GitHubMyIssues(): React.JSX.Element {
  const commandPreferences = useGitHubPreferences<GitHubIssueListPreferences>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [selectedRepository, setSelectedRepository] = useState("")
  const loadSections = useCallback(
    () =>
      loadMyIssueSections({
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
    failureMessage: "Failed to load GitHub issues",
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

    const nextSections: GitHubIssueSection[] = []
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
            onAction={() => void openGitHubSettings("my-issues")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="My Issues"
      searchBarAccessory={searchBarAccessory}
      searchBarPlaceholder="Filter by title, repository, or issue number"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("my-issues")}
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
                  <Action.RunBotAgent
                    icon={<Bot className="h-4 w-4" />}
                    input={createRunBotAgentInput(item)}
                    title="Run with Agent"
                  />
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
