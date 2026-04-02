import { defineNativeExtension } from "../../shared/native-extensions"
import { githubManifest } from "./manifest"

export default defineNativeExtension({
  commands: [
    {
      modulePath: "./src/my-issues.tsx",
      name: "my-issues"
    }
  ],
  manifest: githubManifest
})
