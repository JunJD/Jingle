import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { viewport as translateViewport } from "./src/translate.meta"
import { TRANSLATE_EXTENSION_ID } from "./src/contracts"

export const translateManifest = defineNativeExtensionManifest({
  capabilities: ["clipboard", "navigation", "surface"],
  icon: "assets/icon.svg",
  iconName: "languages",
  runtimeCapabilities: ["ai", "clipboard", "navigation", "preferences"],
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
    }
  ],
  description: "Translate text inside the launcher.",
  name: TRANSLATE_EXTENSION_ID,
  title: "Translate"
})
