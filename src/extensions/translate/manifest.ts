import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { defineLocalizedText as l } from "@shared/i18n"
import { viewport as translateViewport } from "./src/translate.meta"
import { TRANSLATE_EXTENSION_ID } from "./src/contracts"

export const translateManifest = defineNativeExtensionManifest({
  capabilities: ["clipboard", "navigation", "surface"],
  icon: "assets/icon.svg",
  iconName: "languages",
  runtimeCapabilities: ["ai", "clipboard", "navigation", "preferences"],
  commands: [
    {
      description: l("Translate selected text or free-form input.", "翻译选中文本或自由输入。"),
      keywords: ["translate", "translation", "翻译"],
      mode: "view",
      name: "translate",
      preferences: [
        {
          default: "",
          description: l(
            "Optional model override used by translation commands.",
            "可选：为翻译命令指定模型。"
          ),
          name: "modelId",
          placeholder: l("Use app default", "使用应用默认模型"),
          title: l("Translate Model", "翻译模型"),
          type: "model"
        }
      ],
      runtime: {
        viewport: translateViewport
      },
      title: l("Translate", "翻译")
    }
  ],
  description: l("Translate text inside the launcher.", "在启动器里翻译文本。"),
  name: TRANSLATE_EXTENSION_ID,
  title: l("Translate", "翻译")
})
