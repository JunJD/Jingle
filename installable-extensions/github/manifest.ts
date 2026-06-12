import { defineLocalizedText as l, defineNativeExtensionManifest } from "@openwork/extension-api"
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
import { GITHUB_EXTENSION_ID, GITHUB_RPC_METHODS } from "./contracts"

export const githubManifest = defineNativeExtensionManifest({
  aiCapability: {
    connectionId: "default",
    description: "GitHub issues, pull requests, repositories, notifications, and workflow runs.",
    guide:
      "Use this capability for GitHub work only after the user connects GitHub. If auth status is missing, explain that GitHub needs to be connected in Settings before you can inspect repositories, issues, pull requests, notifications, or workflow runs.",
    id: "github",
    instructions: [
      "Use GitHub for issues, pull requests, repositories, notifications, and workflow runs.",
      "If GitHub is not connected, explain that GitHub needs to be connected in Settings before you can inspect or modify GitHub data.",
      "Use search qualifiers directly when the user gives repository, author, assignee, state, label, or text filters.",
      "When using repo: search qualifiers, use the full owner/repository name. If only a repository short name is known, search repositories first or ask for the owner before searching issues or pull requests inside it.",
      "For the current connected GitHub user, prefer the dedicated listMyIssues/listMyPullRequests/listRepositories tools over writing author:@me, assignee:@me, or user:@me search queries.",
      "Create issues only when the user explicitly asks to create or file an issue.",
      "Do not claim to have searched GitHub unless a GitHub tool was available and called."
    ],
    mention: {
      label: l("GitHub", "GitHub"),
      value: "github"
    },
    publicPreferenceNames: ["apiBaseUrl"],
    requiredPreferenceNames: ["accessToken"],
    title: l("GitHub", "GitHub"),
    toolDisplays: {
      createIssue: {
        description: l("Create a GitHub issue in a repository.", "在仓库中创建 GitHub Issue。"),
        title: l("Create Issue", "创建 Issue")
      },
      listMyIssues: {
        description: l(
          "List issues created by, assigned to, or mentioning the current user.",
          "列出由当前用户创建、分配给当前用户或提到当前用户的 Issues。"
        ),
        title: l("List My Issues", "列出我的 Issues")
      },
      listMyPullRequests: {
        description: l(
          "List pull requests authored by, assigned to, mentioning, reviewed by, or requesting review from the current user.",
          "列出当前用户创建、分配、被提及、已评审或待评审的 Pull Requests。"
        ),
        title: l("List My Pull Requests", "列出我的 Pull Requests")
      },
      listNotifications: {
        description: l(
          "List GitHub notifications for the current user.",
          "列出当前用户的 GitHub 通知。"
        ),
        title: l("List Notifications", "列出通知")
      },
      listRepositories: {
        description: l(
          "List recently updated or starred repositories for the current user.",
          "列出当前用户最近更新或加星的仓库。"
        ),
        title: l("List Repositories", "列出仓库")
      },
      listWorkflowRuns: {
        description: l(
          "List recent GitHub Actions workflow runs for a repository.",
          "列出仓库最近的 GitHub Actions workflow runs。"
        ),
        title: l("List Workflow Runs", "列出 Workflow Runs")
      },
      searchIssues: {
        description: l(
          "Search GitHub issues with GitHub search qualifiers.",
          "使用 GitHub 搜索限定符搜索 Issues。"
        ),
        title: l("Search Issues", "搜索 Issues")
      },
      searchPullRequests: {
        description: l(
          "Search GitHub pull requests with GitHub search qualifiers.",
          "使用 GitHub 搜索限定符搜索 Pull Requests。"
        ),
        title: l("Search Pull Requests", "搜索 Pull Requests")
      },
      searchRepositories: {
        description: l(
          "Search GitHub repositories with GitHub search qualifiers.",
          "使用 GitHub 搜索限定符搜索仓库。"
        ),
        title: l("Search Repositories", "搜索仓库")
      }
    },
    toolNames: [
      "listMyIssues",
      "listMyPullRequests",
      "searchIssues",
      "searchPullRequests",
      "searchRepositories",
      "listRepositories",
      "listNotifications",
      "listWorkflowRuns",
      "createIssue"
    ]
  },
  capabilities: ["navigation", "rpc", "surface"],
  connection: {
    auth: {
      authorizationUrl: "https://jingle.cool/oauth/github/start",
      clientId: "jingle-desktop",
      redirect: {
        callbackPath: "/oauth/callback",
        method: "app-scheme",
        scheme: "jingle"
      },
      scopes: ["repo", "read:user", "notifications"],
      secretNames: ["accessToken"],
      tokenUrl: "https://jingle.cool/oauth/github/token",
      type: "oauth"
    },
    connectGuide:
      "Connect GitHub from Jingle Settings. Jingle opens jingle.cool for authorization and stores the returned GitHub access token locally.",
    id: "default",
    provider: "github",
    publicPreferenceNames: ["apiBaseUrl"],
    title: l("GitHub", "GitHub")
  },
  icon: "assets/icon.svg",
  iconName: "github",
  runtimeCapabilities: ["navigation", "preferences", "rpc", "settings", "shell"],
  preferences: [
    {
      default: "https://api.github.com",
      description: l(
        "Override this only if you use GitHub Enterprise.",
        "仅在使用 GitHub Enterprise 时覆盖此项。"
      ),
      name: "apiBaseUrl",
      placeholder: "https://api.github.com",
      title: l("GitHub API Base URL", "GitHub API 基础 URL"),
      type: "text"
    },
    {
      default: "",
      description: l(
        "Default query used when opening global search commands.",
        "打开全局搜索命令时使用的默认查询。"
      ),
      name: "defaultSearchTerms",
      placeholder: "author:octocat state:open",
      title: l("Default Search Terms", "默认搜索条件"),
      type: "text"
    },
    {
      default: "25",
      description: l(
        "How many results each command should request per load.",
        "每次加载时每个命令请求的结果数量。"
      ),
      name: "numberOfResults",
      title: l("Number of Results", "结果数量"),
      type: "text"
    }
  ],
  commands: [
    {
      description: l(
        "List GitHub issues created by you, assigned to you, or mentioning you.",
        "列出由你创建、分配给你或提到你的 GitHub Issues。"
      ),
      keywords: ["github", "issue", "issues", "pull request", "pr", "代码审查"],
      mode: "view",
      name: "my-issues",
      preferences: [
        {
          default: true,
          description: l("Show issues you created.", "显示你创建的 Issues。"),
          name: "showCreated",
          title: l("Show Created", "显示已创建"),
          type: "checkbox"
        },
        {
          default: true,
          description: l("Show issues assigned to you.", "显示分配给你的 Issues。"),
          name: "showAssigned",
          title: l("Show Assigned", "显示已分配"),
          type: "checkbox"
        },
        {
          default: true,
          description: l("Show issues where you were mentioned.", "显示提到你的 Issues。"),
          name: "showMentioned",
          title: l("Show Mentioned", "显示被提及"),
          type: "checkbox"
        },
        {
          default: false,
          description: l("Include recently closed issues.", "包含最近关闭的 Issues。"),
          name: "showRecentlyClosed",
          title: l("Show Recently Closed", "显示最近关闭"),
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: myIssuesViewport
      },
      title: l("My Issues", "我的 Issues")
    },
    {
      description: l(
        "List your GitHub pull requests for review and tracking.",
        "列出需要你评审和跟踪的 GitHub Pull Requests。"
      ),
      keywords: ["github", "pull requests", "pr", "merge", "review"],
      mode: "view",
      name: "my-pull-requests",
      preferences: [
        {
          default: true,
          description: l("Show pull requests assigned to you.", "显示分配给你的 Pull Requests。"),
          name: "includeAssigned",
          title: l("Show Assigned", "显示已分配"),
          type: "checkbox"
        },
        {
          default: true,
          description: l(
            "Show pull requests where you were mentioned.",
            "显示提到你的 Pull Requests。"
          ),
          name: "includeMentioned",
          title: l("Show Mentioned", "显示被提及"),
          type: "checkbox"
        },
        {
          default: true,
          description: l(
            "Show pull requests requesting your review.",
            "显示请求你评审的 Pull Requests。"
          ),
          name: "includeReviewRequests",
          title: l("Show Review Requests", "显示评审请求"),
          type: "checkbox"
        },
        {
          default: false,
          description: l(
            "Show pull requests you already reviewed.",
            "显示你已评审的 Pull Requests。"
          ),
          name: "includeReviewed",
          title: l("Show Reviewed", "显示已评审"),
          type: "checkbox"
        },
        {
          default: false,
          description: l(
            "Include recently closed pull requests.",
            "包含最近关闭的 Pull Requests。"
          ),
          name: "includeRecentlyClosed",
          title: l("Show Recently Closed", "显示最近关闭"),
          type: "checkbox"
        },
        {
          default: false,
          description: l("Include draft pull requests.", "包含草稿 Pull Requests。"),
          name: "includeDrafts",
          title: l("Include Drafts", "包含草稿"),
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: myPullRequestsViewport
      },
      title: l("My Pull Requests", "我的 Pull Requests")
    },
    {
      description: l("Search GitHub issues across repositories.", "跨仓库搜索 GitHub Issues。"),
      keywords: ["github", "search", "issue", "issues"],
      mode: "view",
      name: "search-issues",
      runtime: {
        viewport: searchIssuesViewport
      },
      title: l("Search Issues", "搜索 Issues")
    },
    {
      description: l(
        "Search GitHub pull requests across repositories.",
        "跨仓库搜索 GitHub Pull Requests。"
      ),
      keywords: ["github", "search", "pull request", "pr"],
      mode: "view",
      name: "search-pull-requests",
      runtime: {
        viewport: searchPullRequestsViewport
      },
      title: l("Search Pull Requests", "搜索 Pull Requests")
    },
    {
      description: l("Search GitHub repositories.", "搜索 GitHub 仓库。"),
      keywords: ["github", "repository", "repo", "search"],
      mode: "view",
      name: "search-repositories",
      preferences: [
        {
          default: false,
          description: l("Include forked repositories in the results.", "在结果中包含 fork 仓库。"),
          name: "includeForks",
          title: l("Include Forks", "包含 Fork"),
          type: "checkbox"
        },
        {
          default: false,
          description: l("Include archived repositories in the results.", "在结果中包含归档仓库。"),
          name: "includeArchived",
          title: l("Include Archived", "包含归档"),
          type: "checkbox"
        },
        {
          default: true,
          description: l("Show the owner name in repository rows.", "在仓库行中显示所有者名称。"),
          name: "displayOwnerName",
          title: l("Display Owner Name", "显示所有者名称"),
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: searchRepositoriesViewport
      },
      title: l("Search Repositories", "搜索仓库")
    },
    {
      description: l(
        "Inspect recent GitHub Actions workflow runs for one of your repositories.",
        "查看某个仓库最近的 GitHub Actions workflow runs。"
      ),
      keywords: ["github", "actions", "workflow", "workflow runs", "ci", "build"],
      mode: "view",
      name: "workflow-runs",
      runtime: {
        viewport: workflowRunsViewport
      },
      title: l("Workflow Runs", "Workflow Runs")
    },
    {
      description: l(
        "Create a new issue in one of your GitHub repositories.",
        "在你的某个 GitHub 仓库中新建 Issue。"
      ),
      keywords: ["github", "create", "issue", "new issue"],
      mode: "view",
      name: "create-issue",
      runtime: {
        viewport: createIssueViewport
      },
      title: l("Create Issue", "创建 Issue")
    },
    {
      description: l(
        "Create a pull request in one of your GitHub repositories.",
        "在你的某个 GitHub 仓库中创建 Pull Request。"
      ),
      keywords: ["github", "create", "pull request", "pr", "merge request"],
      mode: "view",
      name: "create-pull-request",
      runtime: {
        viewport: createPullRequestViewport
      },
      title: l("Create Pull Request", "创建 Pull Request")
    },
    {
      description: l(
        "List inbox notifications from all repositories or a selected repository.",
        "列出全部仓库或所选仓库的收件箱通知。"
      ),
      icon: "assets/notifications.svg",
      keywords: ["github", "notifications", "inbox", "mentions"],
      mode: "view",
      name: "notifications",
      runtime: {
        viewport: notificationsViewport
      },
      title: l("Notifications", "通知")
    },
    {
      description: l("Show repositories you worked on most recently.", "显示你最近处理过的仓库。"),
      keywords: ["github", "repositories", "recent", "repo"],
      mode: "view",
      name: "my-latest-repositories",
      runtime: {
        viewport: myLatestRepositoriesViewport
      },
      title: l("My Latest Repositories", "我最近的仓库")
    },
    {
      description: l("Show repositories you starred on GitHub.", "显示你在 GitHub 上加星的仓库。"),
      keywords: ["github", "repositories", "starred", "repo"],
      mode: "view",
      name: "my-starred-repositories",
      runtime: {
        viewport: myStarredRepositoriesViewport
      },
      title: l("My Starred Repositories", "我加星的仓库")
    },
    {
      description: l(
        "Show unread GitHub notifications in the menu bar.",
        "在菜单栏显示未读 GitHub 通知。"
      ),
      icon: "assets/notifications.svg",
      keywords: ["github", "notifications", "menu bar", "tray"],
      mode: "menu-bar",
      name: "unread-notifications",
      preferences: [
        {
          default: "60",
          description: l(
            "How often the menu bar should refresh unread notifications.",
            "菜单栏刷新未读通知的间隔。"
          ),
          name: "refreshIntervalSeconds",
          title: l("Refresh Interval Seconds", "刷新间隔秒数"),
          type: "text"
        },
        {
          default: true,
          description: l(
            "Show the unread count in the menu bar title.",
            "在菜单栏标题中显示未读数量。"
          ),
          name: "showUnreadCount",
          title: l("Show Unread Count", "显示未读数量"),
          type: "checkbox"
        }
      ],
      runtime: {},
      title: l("Unread Notifications", "未读通知")
    }
  ],
  description: l(
    "Work with your GitHub issues inside the launcher.",
    "在启动器里处理 GitHub Issues。"
  ),
  name: GITHUB_EXTENSION_ID,
  rpcMethods: [...GITHUB_RPC_METHODS],
  title: l("GitHub", "GitHub")
})
