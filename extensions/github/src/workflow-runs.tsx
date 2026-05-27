import { AlertCircle, RefreshCw, Workflow } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Action, ActionPanel, Detail, List, useNativeExtensionNavigation } from "@openwork/extension-api"
import {
  listGitHubViewerRepositories,
  listGitHubWorkflowRuns,
  normalizeGitHubPreferences,
  openGitHubSettings,
  type GitHubViewerRepository,
  type GitHubWorkflowRun,
  useGitHubCommandPreferences
} from "./runtime-client"
import {
  formatResultCount,
  formatUpdatedAt,
  getWorkflowRunAccessories,
  getWorkflowRunIcon
} from "./view-helpers"

function WorkflowRunDetail(props: { run: GitHubWorkflowRun }): React.JSX.Element {
  const { run } = props

  return (
    <Detail
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open Workflow Run in Browser" url={run.url} />
        </ActionPanel>
      }
      markdown={`# ${run.name}\n\n**Repository:** ${run.repositoryFullName}\n\n**Status:** ${run.status ?? "unknown"}${run.conclusion ? ` · ${run.conclusion}` : ""}\n\n**Event:** ${run.event}\n\n**Branch:** ${run.headBranch || "_Unknown_"}\n\n**Commit:** ${run.headSha ? `\`${run.headSha}\`` : "_Unknown_"}\n\n**Author:** ${run.headCommitAuthor}\n\n${run.headCommitMessage.trim() ? `## Commit Message\n\n${run.headCommitMessage}` : "_No commit message available._"}`}
      metadata={
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
      }
      navigationTitle="Workflow Run"
    />
  )
}

export default function GitHubWorkflowRuns(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const commandPreferences = useGitHubCommandPreferences<Record<string, never>>()
  const resolvedPreferences = useMemo(
    () => normalizeGitHubPreferences(commandPreferences),
    [commandPreferences]
  )
  const [repositories, setRepositories] = useState<GitHubViewerRepository[]>([])
  const [selectedRepository, setSelectedRepository] = useState("")
  const [items, setItems] = useState<GitHubWorkflowRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false)
  const [isLoadingRuns, setIsLoadingRuns] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (!resolvedPreferences.accessToken) {
        return
      }

      setIsLoadingRepositories(true)
      setError(null)

      try {
        const nextRepositories = await listGitHubViewerRepositories({
          preferences: resolvedPreferences
        })

        if (cancelled) {
          return
        }

        setRepositories(nextRepositories)
        setItems([])
        setSelectedRepository((current) =>
          nextRepositories.some((repository) => repository.fullName === current)
            ? current
            : (nextRepositories[0]?.fullName ?? "")
        )
      } catch (nextError) {
        if (!cancelled) {
          setRepositories([])
          setItems([])
          setError(
            nextError instanceof Error ? nextError.message : "Failed to load GitHub repositories"
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRepositories(false)
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
      if (!resolvedPreferences.accessToken || !selectedRepository) {
        return
      }

      setIsLoadingRuns(true)
      setError(null)

      try {
        const nextItems = await listGitHubWorkflowRuns({
          preferences: resolvedPreferences,
          repositoryFullName: selectedRepository
        })

        if (!cancelled) {
          setItems(nextItems)
        }
      } catch (nextError) {
        if (!cancelled) {
          setItems([])
          setError(nextError instanceof Error ? nextError.message : "Failed to load workflow runs")
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRuns(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [reloadVersion, resolvedPreferences, selectedRepository])

  const isLoading = isLoadingRepositories || isLoadingRuns

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
            onAction={() => void openGitHubSettings("workflow-runs")}
            title="Open GitHub Settings"
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle="Workflow Runs"
      searchBarAccessory={
        repositories.length > 0 ? (
          <List.Dropdown onChange={setSelectedRepository} value={selectedRepository}>
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
        ) : null
      }
      searchBarPlaceholder="Filter by workflow, branch, commit, or status"
    >
      {!resolvedPreferences.accessToken ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<AlertCircle className="h-4 w-4" />}
                onAction={() => void openGitHubSettings("workflow-runs")}
                title="Add GitHub Token"
              />
            </ActionPanel>
          }
          description="GitHub needs a personal access token before it can load workflow runs."
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
                onAction={() => void openGitHubSettings("workflow-runs")}
                title="Open GitHub Settings"
              />
            </ActionPanel>
          }
          description={error}
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
