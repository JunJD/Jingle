import { defineNativeExtension } from "../../shared/native-extensions"
import { translateManifest } from "./manifest"

export default defineNativeExtension({
  commands: [
    {
      modulePath: "./src/translate.tsx",
      name: "translate"
    },
    {
      modulePath: "./src/translate-quick-copy.ts",
      name: "translate-quick-copy"
    }
  ],
  manifest: translateManifest,
  serviceModulePath: "./main/service.ts"
})
