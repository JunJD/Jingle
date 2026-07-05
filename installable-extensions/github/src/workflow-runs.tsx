import { AlertCircle, RefreshCw, Workflow } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import {
  Action,
  ActionPanel,
  Detail,
  List,
  useNativeExtensionNavigation
} from "@jingle/extension-api"
import {
  listGitHubViewerRepositories,
  listGitHubWorkflowRuns,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubViewerRepository,
  type GitHubWorkflowRun,
  useGitHubPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"
import {
  formatResultCount,
  formatUpdatedAt,
  getWorkflowRunAccessories,
  getWorkflowRunIcon
} from "./view-helpers"

const EMPTY_REPOSITORIES: GitHubViewerRepository[] = []
const EMPTY_WORKFLOW_RUNS: GitHubWorkflowRun[] = []

function WorkflowRunDetail(props: { run: GitHubWorkflowRun }): React.JSX.Element {
  const { run } = props
  const metadata = useMemo(
    () => (
      <Detail.Metadata>
        <Detail.Metadata.Label text={run.repositoryFullName} title="Repository" />
        <Detail.Metadata.Label text={`#${run.runNumber}`} title="Run Number" />
        <Detail.Metadata.Label text={run.event} title="Event" />
        <Detail.Metadata.Label
          text={`${run.status ?? "unknown"}${run.conclusion ? ` · ${run.conclusion}` : ""}`}
          title="Result"
        />
        <Detail.Metadata.Label text={new Date(run.updatedAt).toLocaleString()} title="Updated" />
      </Detail.Metadata>
    ),
    [run]
  )

  return (
    <Detail
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open Workflow Run in Browser" url={run.url} />
        </ActionPanel>
      }
      markdown={`# ${run.name}\n\n**Repository:** ${run.repositoryFullName}\n\n**Status:** ${run.status ?? "unknown"}${run.conclusion ? ` · ${run.conclusion}` : ""}\n\n**Event:** ${run.event}\n\n**Branch:** ${run.headBranch || "_Unknown_"}\n\n**Commit:** ${run.headSha ? `\`${run.headSha}\`` : "_Unknown_"}\n\n**Author:** ${run.headCommitAuthor}\n\n${run.headCommitMessage.trim() ? `## Commit Message\n\n${run.headCommitMessage}` : "_No commit message available._"}`}
      metadata={metadata}
      navigationTitle="Workflow Run"
    />
  )
}

export default function GitHubWorkflowRuns(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const githubPreferences = useGitHubPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(githubPreferences),
    [githubPreferences]
  )
  const [repositorySelection, setRepositorySelection] = useState("")
  const loadRepositories = useCallback(
    () =>
      listGitHubViewerRepositories({
        preferences: resolvedPreferences
      }),
    [resolvedPreferences]
  )
  const {
    data: repositories,
    error: repositoryError,
    isLoading: isLoadingRepositories,
    refresh: refreshRepositories
  } = useRefreshableData({
    emptyData: EMPTY_REPOSITORIES,
    enabled: Boolean(resolvedPreferences.accessToken),
    failureMessage: "Failed to load GitHub repositories",
    load: loadRepositories
  })
  const selectedRepository = repositories.some(
    (repository) => repository.fullName === repositorySelection
  )
    ? repositorySelection
    : (repositories[0]?.fullName ?? "")

  const loadRuns = useCallback(
    () =>
      listGitHubWorkflowRuns({
        preferences: resolvedPreferences,
        repositoryFullName: selectedRepository
      }),
    [resolvedPreferences, selectedRepository]
  )
  const {
    data: items,
    error: runError,
    isLoading: isLoadingRuns,
    refresh: refreshRuns
  } = useRefreshableData({
    emptyData: EMPTY_WORKFLOW_RUNS,
    enabled: Boolean(resolvedPreferences.accessToken && selectedRepository),
    failureMessage: "Failed to load workflow runs",
    load: loadRuns
  })

  const isLoading = isLoadingRepositories || isLoadingRuns
  const displayError = repositoryError ?? runError
  const handleRefresh = useCallback(() => {
    refreshRepositories()
    refreshRuns()
  }, [refreshRepositories, refreshRuns])
  const searchBarAccessory = useMemo(
    () =>
      repositories.length > 0 ? (
        <List.Dropdown onChange={setRepositorySelection} value={selectedRepository}>
          <List.Dropdown.Section title="Repository">
            {repositories.map((repository) => (
              <List.Dropdown.Item
                key={repository.id}
                title={repository.fullName}
                value={repository.fullName}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      ) : null,
    [repositories, selectedRepository]
  )

  return (
    <List
      actions={
        <ActionPanel>
          <Action
            icon={<RefreshCw className="h-4 w-4" />}
            onAction={handleRefresh}
            title="Refresh"
          />
          <Action
            icon={<AlertCircle className="h-4 w-4" />}
            onAction={() => void openGitHubSettings("workflow-runs")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="Workflow Runs"
      searchBarAccessory={searchBarAccessory}
      searchBarPlaceholder="Filter by workflow, branch, commit, or status"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("workflow-runs")}
                title="Connect GitHub"
              />
            </ActionPanel>
          }
          description="GitHub needs to be connected before it can load workflow runs."
          title="Connect GitHub"
        />
      ) : displayError ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<RefreshCw className="h-4 w-4" />}
                onAction={handleRefresh}
                title="Retry"
              />
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("workflow-runs")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={displayError}
          title="GitHub Request Failed"
        />
      ) : repositories.length === 0 && !isLoading ? (
        <List.EmptyView title="No repositories found" />
      ) : items.length === 0 && !isLoading ? (
        <List.EmptyView title="No recent workflow runs found" />
      ) : null}

      {items.length > 0 ? (
        <List.Section
          subtitle={formatResultCount(items.length, "run")}
          title={selectedRepository || "Workflow Runs"}
        >
          {items.map((run) => (
            <List.Item
              key={run.id}
              actions={
                <ActionPanel>
                  <Action
                    icon={<Workflow className="h-4 w-4" />}
                    onAction={() => navigation.push(<WorkflowRunDetail run={run} />)}
                    title="Show Workflow Run Detail"
                  />
                  <Action.OpenInBrowser title="Open Workflow Run in Browser" url={run.url} />
                </ActionPanel>
              }
              accessories={getWorkflowRunAccessories(run)}
              icon={getWorkflowRunIcon(run)}
              keywords={[
                run.repositoryFullName,
                run.event,
                run.headBranch,
                run.headSha,
                run.status ?? "",
                run.conclusion ?? ""
              ]}
              subtitle={run.headCommitMessage || formatUpdatedAt(run.updatedAt)}
              title={run.name}
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  )
}
