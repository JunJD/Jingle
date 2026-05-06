import type { ComponentType } from "react"
import type { ExtensionRuntimeLaunchContext } from "@shared/extension-runtime-protocol"
import type { ExtensionRuntimeNavigation } from "../extension-runtime/sdk"
import AppleRemindersCreateReminder from "./apple-reminders/src/create-reminder"
import AppleRemindersMyReminders from "./apple-reminders/src/my-reminders"
import AppleRemindersQuickAddReminder from "./apple-reminders/src/quick-add-reminder"
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
import TranslateQuickCopy from "./translate/src/translate-quick-copy"

export interface NativeExtensionRuntimeNoViewRunContext extends ExtensionRuntimeLaunchContext {
  navigation: ExtensionRuntimeNavigation
}

interface NativeExtensionRuntimeViewCommandDefinition {
  Component: ComponentType
  commandName: string
  extensionName: string
  mode: "view"
}

interface NativeExtensionRuntimeNoViewCommandDefinition {
  commandName: string
  extensionName: string
  mode: "no-view"
  run: (context: NativeExtensionRuntimeNoViewRunContext) => Promise<void> | void
}

export type NativeExtensionRuntimeCommandDefinition =
  | NativeExtensionRuntimeViewCommandDefinition
  | NativeExtensionRuntimeNoViewCommandDefinition

const nativeExtensionRuntimeCommandDefinitions: NativeExtensionRuntimeCommandDefinition[] = [
  {
    Component: AppleRemindersCreateReminder,
    commandName: "create-reminder",
    extensionName: "apple-reminders",
    mode: "view"
  },
  {
    Component: AppleRemindersMyReminders,
    commandName: "my-reminders",
    extensionName: "apple-reminders",
    mode: "view"
  },
  {
    commandName: "quick-add-reminder",
    extensionName: "apple-reminders",
    mode: "no-view",
    run: AppleRemindersQuickAddReminder
  },
  {
    Component: GitHubCreateIssue,
    commandName: "create-issue",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubCreatePullRequest,
    commandName: "create-pull-request",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubMyIssues,
    commandName: "my-issues",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubMyLatestRepositories,
    commandName: "my-latest-repositories",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubMyPullRequests,
    commandName: "my-pull-requests",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubMyStarredRepositories,
    commandName: "my-starred-repositories",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubNotifications,
    commandName: "notifications",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubSearchIssues,
    commandName: "search-issues",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubSearchPullRequests,
    commandName: "search-pull-requests",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubSearchRepositories,
    commandName: "search-repositories",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: GitHubWorkflowRuns,
    commandName: "workflow-runs",
    extensionName: "github",
    mode: "view"
  },
  {
    Component: TodoList,
    commandName: "index",
    extensionName: "todo-list",
    mode: "view"
  },
  {
    commandName: "translate-quick-copy",
    extensionName: "translate",
    mode: "no-view",
    run: TranslateQuickCopy
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
