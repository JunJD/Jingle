import { defineNativeExtensionRuntimeMetadata } from "@jingle/extension-api"
import { NOTION_COMMAND_NAMES, NOTION_SUBJECT_TERMS } from "./identity"

export const notionRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: NOTION_COMMAND_NAMES.addTextToPage,
      search: {
        aliases: ["add text to page", "add text", "append"],
        keywords: [...NOTION_SUBJECT_TERMS, "add", "append", "text", "追加", "添加"]
      }
    },
    {
      name: NOTION_COMMAND_NAMES.createDatabasePage,
      search: {
        aliases: ["create database page", "create page", "new page"],
        keywords: [...NOTION_SUBJECT_TERMS, "create", "new", "page", "database", "新增", "新建", "创建"]
      }
    },
    {
      name: NOTION_COMMAND_NAMES.quickCapture,
      search: {
        aliases: ["quick capture", "capture", "clip"],
        keywords: [...NOTION_SUBJECT_TERMS, "quick capture", "capture", "clip", "保存", "剪藏"]
      }
    },
    {
      name: NOTION_COMMAND_NAMES.searchPage,
      search: {
        aliases: ["search page", "search pages", "search"],
        keywords: [...NOTION_SUBJECT_TERMS, "search", "find", "look up", "搜索", "查找", "查询"]
      }
    }
  ],
  extensionName: "notion"
})
