import { defineNativeExtension } from "../../shared/native-extensions"
import { githubManifest } from "./manifest"

export default defineNativeExtension({
  commands: [
    {
      modulePath: "./src/my-issues.tsx",
      name: "my-issues"
    },
    {
      modulePath: "./src/my-pull-requests.tsx",
      name: "my-pull-requests"
    },
    {
      modulePath: "./src/search-issues.tsx",
      name: "search-issues"
    },
    {
      modulePath: "./src/search-pull-requests.tsx",
      name: "search-pull-requests"
    },
    {
      modulePath: "./src/search-repositories.tsx",
      name: "search-repositories"
    },
    {
      modulePath: "./src/workflow-runs.tsx",
      name: "workflow-runs"
    },
    {
      modulePath: "./src/create-issue.tsx",
      name: "create-issue"
    },
    {
      modulePath: "./src/create-pull-request.tsx",
      name: "create-pull-request"
    },
    {
      modulePath: "./src/notifications.tsx",
      name: "notifications"
    },
    {
      modulePath: "./src/my-latest-repositories.tsx",
      name: "my-latest-repositories"
    },
    {
      modulePath: "./src/my-starred-repositories.tsx",
      name: "my-starred-repositories"
    },
    {
      modulePath: "./src/unread-notifications.tsx",
      name: "unread-notifications"
    }
  ],
  manifest: githubManifest
})
