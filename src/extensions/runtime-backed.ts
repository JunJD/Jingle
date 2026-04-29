import { viewport as createReminderViewport } from "./apple-reminders/src/create-reminder.meta"
import { viewport as myRemindersViewport } from "./apple-reminders/src/my-reminders.meta"
import { viewport as githubCreateIssueViewport } from "./github/src/create-issue.meta"
import { viewport as githubCreatePullRequestViewport } from "./github/src/create-pull-request.meta"
import { viewport as githubMyIssuesViewport } from "./github/src/my-issues.meta"
import { viewport as githubMyLatestRepositoriesViewport } from "./github/src/my-latest-repositories.meta"
import { viewport as githubMyPullRequestsViewport } from "./github/src/my-pull-requests.meta"
import { viewport as githubMyStarredRepositoriesViewport } from "./github/src/my-starred-repositories.meta"
import { viewport as githubNotificationsViewport } from "./github/src/notifications.meta"
import { viewport as githubSearchIssuesViewport } from "./github/src/search-issues.meta"
import { viewport as githubSearchPullRequestsViewport } from "./github/src/search-pull-requests.meta"
import { viewport as githubSearchRepositoriesViewport } from "./github/src/search-repositories.meta"
import { viewport as githubWorkflowRunsViewport } from "./github/src/workflow-runs.meta"
import { viewport as todoListViewport } from "./todo-list/src/index.meta"

export interface NativeExtensionRuntimeBackedCommand {
  commandName: string
  extensionName: string
  viewport: {
    bodyHeight: number
  }
}

export const nativeExtensionRuntimeBackedCommands = [
  {
    extensionName: "apple-reminders",
    commandName: "create-reminder",
    viewport: createReminderViewport
  },
  {
    extensionName: "apple-reminders",
    commandName: "my-reminders",
    viewport: myRemindersViewport
  },
  {
    extensionName: "github",
    commandName: "create-issue",
    viewport: githubCreateIssueViewport
  },
  {
    extensionName: "github",
    commandName: "create-pull-request",
    viewport: githubCreatePullRequestViewport
  },
  {
    extensionName: "github",
    commandName: "my-issues",
    viewport: githubMyIssuesViewport
  },
  {
    extensionName: "github",
    commandName: "my-latest-repositories",
    viewport: githubMyLatestRepositoriesViewport
  },
  {
    extensionName: "github",
    commandName: "my-pull-requests",
    viewport: githubMyPullRequestsViewport
  },
  {
    extensionName: "github",
    commandName: "my-starred-repositories",
    viewport: githubMyStarredRepositoriesViewport
  },
  {
    extensionName: "github",
    commandName: "notifications",
    viewport: githubNotificationsViewport
  },
  {
    extensionName: "github",
    commandName: "search-issues",
    viewport: githubSearchIssuesViewport
  },
  {
    extensionName: "github",
    commandName: "search-pull-requests",
    viewport: githubSearchPullRequestsViewport
  },
  {
    extensionName: "github",
    commandName: "search-repositories",
    viewport: githubSearchRepositoriesViewport
  },
  {
    extensionName: "github",
    commandName: "workflow-runs",
    viewport: githubWorkflowRunsViewport
  },
  {
    extensionName: "todo-list",
    commandName: "index",
    viewport: todoListViewport
  }
] as const satisfies readonly NativeExtensionRuntimeBackedCommand[]

export function getNativeExtensionRuntimeBackedCommand(params: {
  commandName: string
  extensionName: string
}): NativeExtensionRuntimeBackedCommand | null {
  return (
    nativeExtensionRuntimeBackedCommands.find(
      (command) =>
        command.commandName === params.commandName && command.extensionName === params.extensionName
    ) ?? null
  )
}
