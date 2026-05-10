import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { viewport as translateViewport } from "./src/translate.meta"
import { TRANSLATE_EXTENSION_ID } from "./src/contracts"

export const translateManifest = defineNativeExtensionManifest({
  capabilities: ["clipboard", "navigation", "rpc", "surface"],
  runtimeCapabilities: ["clipboard", "navigation", "preferences", "rpc"],
  commands: [
    {
      description: "Translate selected text or free-form input.",
      keywords: ["translate", "translation", "翻译"],
      mode: "view",
      name: "translate",
      preferences: [
        {
          default: "",
          description: "Optional model override used by translation commands.",
          name: "modelId",
          placeholder: "Use app default",
          title: "Translate Model",
          type: "model"
        }
      ],
      runtime: {
        viewport: translateViewport
      },
      title: "Translate"
    },
    {
      description: "Translate input and copy the result immediately.",
      keywords: ["quick translate", "copy translation", "快速翻译"],
      mode: "no-view",
      name: "translate-quick-copy",
      preferences: [
        {
          default: "",
          description: "Optional model override used by translation commands.",
          name: "modelId",
          placeholder: "Use app default",
          title: "Translate Model",
          type: "model"
        }
      ],
      runtime: {},
      title: "Quick Translate & Copy"
    }
  ],
  description: "Translate text inside the launcher.",
  name: TRANSLATE_EXTENSION_ID,
  rpcMethods: ["translate"],
  title: "Translate"
})
