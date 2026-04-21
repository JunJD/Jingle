import { defineNativeExtensionManifest } from "@shared/native-extensions"

export const githubManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "surface"],
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
      title: "My Pull Requests"
    },
    {
      description: "Search GitHub issues across repositories.",
      keywords: ["github", "search", "issue", "issues"],
      mode: "view",
      name: "search-issues",
      title: "Search Issues"
    },
    {
      description: "Search GitHub pull requests across repositories.",
      keywords: ["github", "search", "pull request", "pr"],
      mode: "view",
      name: "search-pull-requests",
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
      title: "Search Repositories"
    },
    {
      description: "Inspect recent GitHub Actions workflow runs for one of your repositories.",
      keywords: ["github", "actions", "workflow", "workflow runs", "ci", "build"],
      mode: "view",
      name: "workflow-runs",
      title: "Workflow Runs"
    },
    {
      description: "Create a new issue in one of your GitHub repositories.",
      keywords: ["github", "create", "issue", "new issue"],
      mode: "view",
      name: "create-issue",
      title: "Create Issue"
    },
    {
      description: "Create a pull request in one of your GitHub repositories.",
      keywords: ["github", "create", "pull request", "pr", "merge request"],
      mode: "view",
      name: "create-pull-request",
      title: "Create Pull Request"
    },
    {
      description: "List inbox notifications from all repositories or a selected repository.",
      keywords: ["github", "notifications", "inbox", "mentions"],
      mode: "view",
      name: "notifications",
      title: "Notifications"
    },
    {
      description: "Show repositories you worked on most recently.",
      keywords: ["github", "repositories", "recent", "repo"],
      mode: "view",
      name: "my-latest-repositories",
      title: "My Latest Repositories"
    },
    {
      description: "Show repositories you starred on GitHub.",
      keywords: ["github", "repositories", "starred", "repo"],
      mode: "view",
      name: "my-starred-repositories",
      title: "My Starred Repositories"
    },
    {
      description: "Show unread GitHub notifications in the menu bar.",
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
      title: "Unread Notifications"
    }
  ],
  description: "Work with your GitHub issues inside the launcher.",
  name: "github",
  title: "GitHub"
})
