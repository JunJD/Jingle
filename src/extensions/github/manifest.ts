import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { viewport as createIssueViewport } from "./src/create-issue.meta"
import { viewport as createPullRequestViewport } from "./src/create-pull-request.meta"
import { viewport as myIssuesViewport } from "./src/my-issues.meta"
import { viewport as myLatestRepositoriesViewport } from "./src/my-latest-repositories.meta"
import { viewport as myPullRequestsViewport } from "./src/my-pull-requests.meta"
import { viewport as myStarredRepositoriesViewport } from "./src/my-starred-repositories.meta"
import { viewport as notificationsViewport } from "./src/notifications.meta"
import { viewport as searchIssuesViewport } from "./src/search-issues.meta"
import { viewport as searchPullRequestsViewport } from "./src/search-pull-requests.meta"
import { viewport as searchRepositoriesViewport } from "./src/search-repositories.meta"
import { viewport as workflowRunsViewport } from "./src/workflow-runs.meta"
import { GITHUB_EXTENSION_ID, GITHUB_RPC_METHODS } from "./src/contracts"

export const githubManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "rpc", "surface"],
  icon: "assets/icon.svg",
  runtimeCapabilities: ["navigation", "preferences", "rpc", "settings", "shell"],
  preferences: [
    {
      description:
        "Personal access token used to read your GitHub data. A classic token with repo access is enough.",
      name: "accessToken",
      placeholder: "ghp_...",
      title: "GitHub Personal Access Token",
      type: "password"
    },
    {
      default: "https://api.github.com",
      description: "Override this only if you use GitHub Enterprise.",
      name: "apiBaseUrl",
      placeholder: "https://api.github.com",
      title: "GitHub API Base URL",
      type: "text"
    },
    {
      default: "",
      description: "Default query used when opening global search commands.",
      name: "defaultSearchTerms",
      placeholder: "author:@me state:open",
      title: "Default Search Terms",
      type: "text"
    },
    {
      default: "25",
      description: "How many results each command should request per load.",
      name: "numberOfResults",
      title: "Number of Results",
      type: "text"
    }
  ],
  commands: [
    {
      description: "List GitHub issues created by you, assigned to you, or mentioning you.",
      keywords: ["github", "issue", "issues", "pull request", "pr", "代码审查"],
      mode: "view",
      name: "my-issues",
      preferences: [
        {
          default: true,
          description: "Show issues you created.",
          name: "showCreated",
          title: "Show Created",
          type: "checkbox"
        },
        {
          default: true,
          description: "Show issues assigned to you.",
          name: "showAssigned",
          title: "Show Assigned",
          type: "checkbox"
        },
        {
          default: true,
          description: "Show issues where you were mentioned.",
          name: "showMentioned",
          title: "Show Mentioned",
          type: "checkbox"
        },
        {
          default: false,
          description: "Include recently closed issues.",
          name: "showRecentlyClosed",
          title: "Show Recently Closed",
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: myIssuesViewport
      },
      title: "My Issues"
    },
    {
      description: "List your GitHub pull requests for review and tracking.",
      keywords: ["github", "pull requests", "pr", "merge", "review"],
      mode: "view",
      name: "my-pull-requests",
      preferences: [
        {
          default: true,
          description: "Show pull requests assigned to you.",
          name: "includeAssigned",
          title: "Show Assigned",
          type: "checkbox"
        },
        {
          default: true,
          description: "Show pull requests where you were mentioned.",
          name: "includeMentioned",
          title: "Show Mentioned",
          type: "checkbox"
        },
        {
          default: true,
          description: "Show pull requests requesting your review.",
          name: "includeReviewRequests",
          title: "Show Review Requests",
          type: "checkbox"
        },
        {
          default: false,
          description: "Show pull requests you already reviewed.",
          name: "includeReviewed",
          title: "Show Reviewed",
          type: "checkbox"
        },
        {
          default: false,
          description: "Include recently closed pull requests.",
          name: "includeRecentlyClosed",
          title: "Show Recently Closed",
          type: "checkbox"
        },
        {
          default: false,
          description: "Include draft pull requests.",
          name: "includeDrafts",
          title: "Include Drafts",
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: myPullRequestsViewport
      },
      title: "My Pull Requests"
    },
    {
      description: "Search GitHub issues across repositories.",
      keywords: ["github", "search", "issue", "issues"],
      mode: "view",
      name: "search-issues",
      runtime: {
        viewport: searchIssuesViewport
      },
      title: "Search Issues"
    },
    {
      description: "Search GitHub pull requests across repositories.",
      keywords: ["github", "search", "pull request", "pr"],
      mode: "view",
      name: "search-pull-requests",
      runtime: {
        viewport: searchPullRequestsViewport
      },
      title: "Search Pull Requests"
    },
    {
      description: "Search GitHub repositories.",
      keywords: ["github", "repository", "repo", "search"],
      mode: "view",
      name: "search-repositories",
      preferences: [
        {
          default: false,
          description: "Include forked repositories in the results.",
          name: "includeForks",
          title: "Include Forks",
          type: "checkbox"
        },
        {
          default: false,
          description: "Include archived repositories in the results.",
          name: "includeArchived",
          title: "Include Archived",
          type: "checkbox"
        },
        {
          default: true,
          description: "Show the owner name in repository rows.",
          name: "displayOwnerName",
          title: "Display Owner Name",
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: searchRepositoriesViewport
      },
      title: "Search Repositories"
    },
    {
      description: "Inspect recent GitHub Actions workflow runs for one of your repositories.",
      keywords: ["github", "actions", "workflow", "workflow runs", "ci", "build"],
      mode: "view",
      name: "workflow-runs",
      runtime: {
        viewport: workflowRunsViewport
      },
      title: "Workflow Runs"
    },
    {
      description: "Create a new issue in one of your GitHub repositories.",
      keywords: ["github", "create", "issue", "new issue"],
      mode: "view",
      name: "create-issue",
      runtime: {
        viewport: createIssueViewport
      },
      title: "Create Issue"
    },
    {
      description: "Create a pull request in one of your GitHub repositories.",
      keywords: ["github", "create", "pull request", "pr", "merge request"],
      mode: "view",
      name: "create-pull-request",
      runtime: {
        viewport: createPullRequestViewport
      },
      title: "Create Pull Request"
    },
    {
      description: "List inbox notifications from all repositories or a selected repository.",
      icon: "assets/notifications.svg",
      keywords: ["github", "notifications", "inbox", "mentions"],
      mode: "view",
      name: "notifications",
      runtime: {
        viewport: notificationsViewport
      },
      title: "Notifications"
    },
    {
      description: "Show repositories you worked on most recently.",
      keywords: ["github", "repositories", "recent", "repo"],
      mode: "view",
      name: "my-latest-repositories",
      runtime: {
        viewport: myLatestRepositoriesViewport
      },
      title: "My Latest Repositories"
    },
    {
      description: "Show repositories you starred on GitHub.",
      keywords: ["github", "repositories", "starred", "repo"],
      mode: "view",
      name: "my-starred-repositories",
      runtime: {
        viewport: myStarredRepositoriesViewport
      },
      title: "My Starred Repositories"
    },
    {
      description: "Show unread GitHub notifications in the menu bar.",
      icon: "assets/notifications.svg",
      keywords: ["github", "notifications", "menu bar", "tray"],
      mode: "menu-bar",
      name: "unread-notifications",
      preferences: [
        {
          default: "60",
          description: "How often the menu bar should refresh unread notifications.",
          name: "refreshIntervalSeconds",
          title: "Refresh Interval Seconds",
          type: "text"
        },
        {
          default: true,
          description: "Show the unread count in the menu bar title.",
          name: "showUnreadCount",
          title: "Show Unread Count",
          type: "checkbox"
        }
      ],
      runtime: {},
      title: "Unread Notifications"
    }
  ],
  description: "Work with your GitHub issues inside the launcher.",
  name: GITHUB_EXTENSION_ID,
  rpcMethods: [...GITHUB_RPC_METHODS],
  title: "GitHub"
})
