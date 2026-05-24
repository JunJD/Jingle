import { defineNativeExtensionRuntime } from "../runtime-api"
import GitHubCreateIssue from "./src/create-issue"
import GitHubCreatePullRequest from "./src/create-pull-request"
import GitHubMyIssues from "./src/my-issues"
import GitHubMyLatestRepositories from "./src/my-latest-repositories"
import GitHubMyPullRequests from "./src/my-pull-requests"
import GitHubMyStarredRepositories from "./src/my-starred-repositories"
import GitHubNotifications from "./src/notifications"
import GitHubSearchIssues from "./src/search-issues"
import GitHubSearchPullRequests from "./src/search-pull-requests"
import GitHubSearchRepositories from "./src/search-repositories"
import GitHubUnreadNotifications from "./src/unread-notifications"
import GitHubWorkflowRuns from "./src/workflow-runs"

export const githubRuntime = defineNativeExtensionRuntime({
  commands: {
    "create-issue": {
      Component: GitHubCreateIssue,
      mode: "view"
    },
    "create-pull-request": {
      Component: GitHubCreatePullRequest,
      mode: "view"
    },
    "my-issues": {
      Component: GitHubMyIssues,
      mode: "view"
    },
    "my-latest-repositories": {
      Component: GitHubMyLatestRepositories,
      mode: "view"
    },
    "my-pull-requests": {
      Component: GitHubMyPullRequests,
      mode: "view"
    },
    "my-starred-repositories": {
      Component: GitHubMyStarredRepositories,
      mode: "view"
    },
    notifications: {
      Component: GitHubNotifications,
      mode: "view"
    },
    "search-issues": {
      Component: GitHubSearchIssues,
      mode: "view"
    },
    "search-pull-requests": {
      Component: GitHubSearchPullRequests,
      mode: "view"
    },
    "search-repositories": {
      Component: GitHubSearchRepositories,
      mode: "view"
    },
    "unread-notifications": {
      Component: GitHubUnreadNotifications,
      mode: "menu-bar"
    },
    "workflow-runs": {
      Component: GitHubWorkflowRuns,
      mode: "view"
    }
  },
  extensionName: "github"
})
