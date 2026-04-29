import type { ComponentType } from "react"
import AppleRemindersCreateReminder from "./apple-reminders/src/create-reminder"
import AppleRemindersMyReminders from "./apple-reminders/src/my-reminders"
import GitHubCreateIssue from "./github/src/create-issue"
import GitHubCreatePullRequest from "./github/src/create-pull-request"
import GitHubMyIssues from "./github/src/my-issues"
import GitHubMyLatestRepositories from "./github/src/my-latest-repositories"
import GitHubMyPullRequests from "./github/src/my-pull-requests"
import GitHubMyStarredRepositories from "./github/src/my-starred-repositories"
import GitHubNotifications from "./github/src/notifications"
import GitHubSearchIssues from "./github/src/search-issues"
import GitHubSearchPullRequests from "./github/src/search-pull-requests"
import GitHubSearchRepositories from "./github/src/search-repositories"
import GitHubWorkflowRuns from "./github/src/workflow-runs"
import TodoList from "./todo-list/src/index"

interface NativeExtensionRuntimeCommandDefinition {
  Component: ComponentType
  commandName: string
  extensionName: string
}

const nativeExtensionRuntimeCommandDefinitions: NativeExtensionRuntimeCommandDefinition[] = [
  {
    Component: AppleRemindersCreateReminder,
    commandName: "create-reminder",
    extensionName: "apple-reminders"
  },
  {
    Component: AppleRemindersMyReminders,
    commandName: "my-reminders",
    extensionName: "apple-reminders"
  },
  {
    Component: GitHubCreateIssue,
    commandName: "create-issue",
    extensionName: "github"
  },
  {
    Component: GitHubCreatePullRequest,
    commandName: "create-pull-request",
    extensionName: "github"
  },
  {
    Component: GitHubMyIssues,
    commandName: "my-issues",
    extensionName: "github"
  },
  {
    Component: GitHubMyLatestRepositories,
    commandName: "my-latest-repositories",
    extensionName: "github"
  },
  {
    Component: GitHubMyPullRequests,
    commandName: "my-pull-requests",
    extensionName: "github"
  },
  {
    Component: GitHubMyStarredRepositories,
    commandName: "my-starred-repositories",
    extensionName: "github"
  },
  {
    Component: GitHubNotifications,
    commandName: "notifications",
    extensionName: "github"
  },
  {
    Component: GitHubSearchIssues,
    commandName: "search-issues",
    extensionName: "github"
  },
  {
    Component: GitHubSearchPullRequests,
    commandName: "search-pull-requests",
    extensionName: "github"
  },
  {
    Component: GitHubSearchRepositories,
    commandName: "search-repositories",
    extensionName: "github"
  },
  {
    Component: GitHubWorkflowRuns,
    commandName: "workflow-runs",
    extensionName: "github"
  },
  {
    Component: TodoList,
    commandName: "index",
    extensionName: "todo-list"
  }
]

const nativeExtensionRuntimeCommandDefinitionMap = new Map(
  nativeExtensionRuntimeCommandDefinitions.map(
    (definition) => [`${definition.extensionName}:${definition.commandName}`, definition] as const
  )
)

export function getNativeExtensionRuntimeCommand(params: {
  commandName: string
  extensionName: string
}): NativeExtensionRuntimeCommandDefinition | null {
  return (
    nativeExtensionRuntimeCommandDefinitionMap.get(
      `${params.extensionName}:${params.commandName}`
    ) ?? null
  )
}
