import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"
import { EXTENSION_SUBJECT_TERMS } from "./identity"

export const figmaFilesRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: "index",
      search: {
        aliases: ["index", "search files"],
        keywords: [
          ...EXTENSION_SUBJECT_TERMS,
          "search",
          "find",
          "look up",
          "搜索",
          "查找",
          "查询"
        ]
      }
    },
    {
      name: "menu-bar",
      search: {
        aliases: ["menu-bar", "menu bar", "quicklook"],
        keywords: [...EXTENSION_SUBJECT_TERMS, "menu-bar", "menu bar", "quicklook"]
      }
    }
  ],
  extensionName: "figma-files"
})
