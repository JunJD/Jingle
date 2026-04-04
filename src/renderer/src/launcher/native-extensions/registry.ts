import { nativeExtensions } from "@extensions/index"
import * as GitHubCreateIssueMeta from "@extensions/github/src/create-issue.meta"
import * as GitHubCreateIssueModule from "@extensions/github/src/create-issue"
import * as GitHubCreatePullRequestMeta from "@extensions/github/src/create-pull-request.meta"
import * as GitHubCreatePullRequestModule from "@extensions/github/src/create-pull-request"
import * as GitHubMyIssuesMeta from "@extensions/github/src/my-issues.meta"
import * as GitHubMyIssuesModule from "@extensions/github/src/my-issues"
import * as GitHubMyLatestRepositoriesMeta from "@extensions/github/src/my-latest-repositories.meta"
import * as GitHubMyLatestRepositoriesModule from "@extensions/github/src/my-latest-repositories"
import * as GitHubMyPullRequestsMeta from "@extensions/github/src/my-pull-requests.meta"
import * as GitHubMyPullRequestsModule from "@extensions/github/src/my-pull-requests"
import * as GitHubMyStarredRepositoriesMeta from "@extensions/github/src/my-starred-repositories.meta"
import * as GitHubMyStarredRepositoriesModule from "@extensions/github/src/my-starred-repositories"
import * as GitHubNotificationsMeta from "@extensions/github/src/notifications.meta"
import * as GitHubNotificationsModule from "@extensions/github/src/notifications"
import * as GitHubSearchIssuesMeta from "@extensions/github/src/search-issues.meta"
import * as GitHubSearchIssuesModule from "@extensions/github/src/search-issues"
import * as GitHubSearchPullRequestsMeta from "@extensions/github/src/search-pull-requests.meta"
import * as GitHubSearchPullRequestsModule from "@extensions/github/src/search-pull-requests"
import * as GitHubSearchRepositoriesMeta from "@extensions/github/src/search-repositories.meta"
import * as GitHubSearchRepositoriesModule from "@extensions/github/src/search-repositories"
import * as GitHubUnreadNotificationsModule from "@extensions/github/src/unread-notifications"
import * as GitHubWorkflowRunsMeta from "@extensions/github/src/workflow-runs.meta"
import * as GitHubWorkflowRunsModule from "@extensions/github/src/workflow-runs"
import * as TodoListIndexMeta from "@extensions/todo-list/src/index.meta"
import * as TodoListIndexModule from "@extensions/todo-list/src/index"
import * as TranslateQuickCopyModule from "@extensions/translate/src/translate-quick-copy"
import * as TranslateMeta from "@extensions/translate/src/translate.meta"
import * as TranslateModule from "@extensions/translate/src/translate"
import type { ComponentType } from "react"
import type { NativeExtensionCommandManifest } from "@shared/native-extensions"

export interface NativeExtensionViewModule {
  default: ComponentType
  viewport:
    | {
        bodyHeight: number
      }
    | {
        getHeight: (
          shellConfig: import("@shared/launcher").LauncherShellConfig
        ) => number
      }
}

export interface NativeExtensionNoViewModule {
  default: (
    context: import("../pages/types").LauncherNoViewCommandRunContext
  ) => Promise<void> | void
}

export interface NativeExtensionBackgroundModule {
  default: ComponentType
}

export interface NativeExtensionMenuBarModule {
  default: ComponentType
}

export interface NativeExtensionCommandRegistryEntry {
  command: NativeExtensionCommandManifest
  extensionCapabilities: (typeof nativeExtensions)[number]["manifest"]["capabilities"]
  extensionName: string
  extensionTitle: string
  module: Record<string, unknown>
}

const nativeExtensionCommandModules = new Map<
  `${string}:${string}`,
  { commandModule: Record<string, unknown>; metaModule?: Record<string, unknown> }
>([
  [
    "github:create-issue",
    { commandModule: GitHubCreateIssueModule, metaModule: GitHubCreateIssueMeta }
  ],
  [
    "github:create-pull-request",
    { commandModule: GitHubCreatePullRequestModule, metaModule: GitHubCreatePullRequestMeta }
  ],
  ["github:my-issues", { commandModule: GitHubMyIssuesModule, metaModule: GitHubMyIssuesMeta }],
  [
    "github:my-latest-repositories",
    {
      commandModule: GitHubMyLatestRepositoriesModule,
      metaModule: GitHubMyLatestRepositoriesMeta
    }
  ],
  [
    "github:my-pull-requests",
    {
      commandModule: GitHubMyPullRequestsModule,
      metaModule: GitHubMyPullRequestsMeta
    }
  ],
  [
    "github:my-starred-repositories",
    {
      commandModule: GitHubMyStarredRepositoriesModule,
      metaModule: GitHubMyStarredRepositoriesMeta
    }
  ],
  [
    "github:notifications",
    { commandModule: GitHubNotificationsModule, metaModule: GitHubNotificationsMeta }
  ],
  [
    "github:search-issues",
    { commandModule: GitHubSearchIssuesModule, metaModule: GitHubSearchIssuesMeta }
  ],
  [
    "github:search-pull-requests",
    {
      commandModule: GitHubSearchPullRequestsModule,
      metaModule: GitHubSearchPullRequestsMeta
    }
  ],
  [
    "github:search-repositories",
    {
      commandModule: GitHubSearchRepositoriesModule,
      metaModule: GitHubSearchRepositoriesMeta
    }
  ],
  ["github:unread-notifications", { commandModule: GitHubUnreadNotificationsModule }],
  [
    "github:workflow-runs",
    { commandModule: GitHubWorkflowRunsModule, metaModule: GitHubWorkflowRunsMeta }
  ],
  ["todo-list:index", { commandModule: TodoListIndexModule, metaModule: TodoListIndexMeta }],
  ["translate:translate", { commandModule: TranslateModule, metaModule: TranslateMeta }],
  ["translate:translate-quick-copy", { commandModule: TranslateQuickCopyModule }]
])

export const nativeExtensionCommandRegistry: NativeExtensionCommandRegistryEntry[] =
  nativeExtensions
    .flatMap((extension) =>
      extension.manifest.commands.map((command) => {
        const commandModule = nativeExtensionCommandModules.get(
          `${extension.manifest.name}:${command.name}`
        )
        if (!commandModule) {
          throw new Error(
            `Native extension "${extension.manifest.name}" command "${command.name}" is missing from the renderer registry`
          )
        }

        return {
          command,
          extensionCapabilities: extension.manifest.capabilities,
          extensionName: extension.manifest.name,
          extensionTitle: extension.manifest.title,
          module: {
            ...commandModule.commandModule,
            ...(commandModule.metaModule ?? {})
          }
        } satisfies NativeExtensionCommandRegistryEntry
      })
    )
    .sort((left, right) => {
      const extensionOrder = left.extensionTitle.localeCompare(right.extensionTitle)
      if (extensionOrder !== 0) {
        return extensionOrder
      }

      return (left.command.title ?? left.command.name).localeCompare(
        right.command.title ?? right.command.name
      )
    })
