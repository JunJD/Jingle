import { defineNativeExtensionManifest } from "../../shared/native-extensions"

export const githubManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "surface"],
  commands: [
    {
      description: "List GitHub issues created by you, assigned to you, or mentioning you.",
      keywords: ["github", "issue", "issues", "pull request", "pr", "代码审查"],
      mode: "view",
      name: "my-issues",
      preferences: [
        {
          description:
            "Personal access token used to read your issues. A classic token with repo access is enough.",
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
    }
  ],
  description: "Work with your GitHub issues inside the launcher.",
  name: "github",
  title: "GitHub"
})
