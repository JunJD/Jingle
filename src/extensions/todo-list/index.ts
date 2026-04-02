import { defineNativeExtension } from "../../shared/native-extensions"
import { todoListManifest } from "./manifest"

export default defineNativeExtension({
  commands: [
    {
      modulePath: "./src/index.tsx",
      name: "index"
    }
  ],
  manifest: todoListManifest
})
