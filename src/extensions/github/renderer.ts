import { defineNativeExtensionRenderer } from "../../shared/native-extensions"
import * as CreateIssueMeta from "./src/create-issue.meta"
import * as CreateIssueModule from "./src/create-issue"
import * as CreatePullRequestMeta from "./src/create-pull-request.meta"
import * as CreatePullRequestModule from "./src/create-pull-request"
import * as MyIssuesMeta from "./src/my-issues.meta"
import * as MyIssuesModule from "./src/my-issues"
import * as MyLatestRepositoriesMeta from "./src/my-latest-repositories.meta"
import * as MyLatestRepositoriesModule from "./src/my-latest-repositories"
import * as MyPullRequestsMeta from "./src/my-pull-requests.meta"
import * as MyPullRequestsModule from "./src/my-pull-requests"
import * as MyStarredRepositoriesMeta from "./src/my-starred-repositories.meta"
import * as MyStarredRepositoriesModule from "./src/my-starred-repositories"
import * as NotificationsMeta from "./src/notifications.meta"
import * as NotificationsModule from "./src/notifications"
import * as SearchIssuesMeta from "./src/search-issues.meta"
import * as SearchIssuesModule from "./src/search-issues"
import * as SearchPullRequestsMeta from "./src/search-pull-requests.meta"
import * as SearchPullRequestsModule from "./src/search-pull-requests"
import * as SearchRepositoriesMeta from "./src/search-repositories.meta"
import * as SearchRepositoriesModule from "./src/search-repositories"
import * as UnreadNotificationsModule from "./src/unread-notifications"
import * as WorkflowRunsMeta from "./src/workflow-runs.meta"
import * as WorkflowRunsModule from "./src/workflow-runs"

export const githubRenderer = defineNativeExtensionRenderer({
  commands: [
    { commandModule: CreateIssueModule, metaModule: CreateIssueMeta, name: "create-issue" },
    {
      commandModule: CreatePullRequestModule,
      metaModule: CreatePullRequestMeta,
      name: "create-pull-request"
    },
    { commandModule: MyIssuesModule, metaModule: MyIssuesMeta, name: "my-issues" },
    {
      commandModule: MyLatestRepositoriesModule,
      metaModule: MyLatestRepositoriesMeta,
      name: "my-latest-repositories"
    },
    {
      commandModule: MyPullRequestsModule,
      metaModule: MyPullRequestsMeta,
      name: "my-pull-requests"
    },
    {
      commandModule: MyStarredRepositoriesModule,
      metaModule: MyStarredRepositoriesMeta,
      name: "my-starred-repositories"
    },
    {
      commandModule: NotificationsModule,
      metaModule: NotificationsMeta,
      name: "notifications"
    },
    { commandModule: SearchIssuesModule, metaModule: SearchIssuesMeta, name: "search-issues" },
    {
      commandModule: SearchPullRequestsModule,
      metaModule: SearchPullRequestsMeta,
      name: "search-pull-requests"
    },
    {
      commandModule: SearchRepositoriesModule,
      metaModule: SearchRepositoriesMeta,
      name: "search-repositories"
    },
    { commandModule: UnreadNotificationsModule, name: "unread-notifications" },
    { commandModule: WorkflowRunsModule, metaModule: WorkflowRunsMeta, name: "workflow-runs" }
  ]
})
