import { defineNativeExtension } from "../../shared/native-extensions"
import { todoListManifest } from "./manifest"

export default defineNativeExtension({
  commands: [
    {
      name: "index"
    }
  ],
  manifest: todoListManifest
})
