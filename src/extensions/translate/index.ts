import { defineNativeExtension } from "../../shared/native-extensions"
import { translateManifest } from "./manifest"

export default defineNativeExtension({
  commands: [
    {
      name: "translate"
    },
    {
      name: "translate-quick-copy"
    }
  ],
  manifest: translateManifest
})
