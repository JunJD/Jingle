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
      modulePath: "./src/my-latest-repositories.tsx",
      name: "my-latest-repositories"
    },
    {
      modulePath: "./src/my-starred-repositories.tsx",
      name: "my-starred-repositories"
    }
  ],
  manifest: githubManifest
})
