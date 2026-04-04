import { defineNativeExtension } from "../../shared/native-extensions"
import { githubManifest } from "./manifest"

export default defineNativeExtension({
  commands: [
    {
      name: "my-issues"
    },
    {
      name: "my-pull-requests"
    },
    {
      name: "search-issues"
    },
    {
      name: "search-pull-requests"
    },
    {
      name: "search-repositories"
    },
    {
      name: "workflow-runs"
    },
    {
      name: "create-issue"
    },
    {
      name: "create-pull-request"
    },
    {
      name: "notifications"
    },
    {
      name: "my-latest-repositories"
    },
    {
      name: "my-starred-repositories"
    },
    {
      name: "unread-notifications"
    }
  ],
  manifest: githubManifest
})
