import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"
import {
  createNotionIntentId,
  NOTION_COMMAND_NAMES,
  NOTION_EXTENSION_ID,
  NOTION_SUBJECT_TERMS
} from "./identity"

const notionCommandAliases = [
  {
    aliases: ["create database page", "create page", "new page"],
    commandName: NOTION_COMMAND_NAMES.createDatabasePage
  },
  {
    aliases: ["search page", "search pages", "search"],
    commandName: NOTION_COMMAND_NAMES.searchPage
  },
  {
    aliases: ["quick capture", "capture", "clip"],
    commandName: NOTION_COMMAND_NAMES.quickCapture
  },
  {
    aliases: ["add text to page", "add text", "append"],
    commandName: NOTION_COMMAND_NAMES.addTextToPage
  }
]

interface NotionSearchCopy {
  launcher: {
    openGeneric: string
    resultKindExtension: string
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function hasAnyTerm(query: string, terms: readonly string[]): boolean {
  return terms.some((term) => query.includes(term))
}

function extractUrl(query: string): string | null {
  return query.match(/https?:\/\/\S+/i)?.[0] ?? null
}

function hasNotionSubject(query: string): boolean {
  return NOTION_SUBJECT_TERMS.some((term) =>
    term === "notion"
      ? /(^|[^a-z0-9-])notion($|[^a-z0-9-])/.test(query)
      : query.includes(term)
  )
}

function matchesNotionCommandAlias(
  query: string,
  config: (typeof notionCommandAliases)[number]
): boolean {
  return NOTION_SUBJECT_TERMS.some((subject) =>
    config.aliases.some((alias) => query === `${subject} ${alias}` || query === `${alias} ${subject}`)
  )
}

function createNotionPresentation(copy: NotionSearchCopy, primaryActionLabel: string) {
  return {
    categoryLabel: copy.launcher.resultKindExtension,
    icon: {
      extensionName: NOTION_EXTENSION_ID,
      icon: "assets/notion-logo.png",
      iconName: "notion",
      type: "extension" as const
    },
    listActionLabel: copy.launcher.openGeneric,
    primaryActionLabel,
    tone: "accent" as const
  }
}

function createSearchNotionIntent(copy: NotionSearchCopy, query: string) {
  const trimmedQuery = query.trim()
  const normalizedQuery = normalizeQuery(query)

  if (
    !hasNotionSubject(normalizedQuery) ||
    !hasAnyTerm(normalizedQuery, ["search", "find", "look up", "搜索", "查找", "查询"])
  ) {
    return []
  }

  return [
    {
      commandName: NOTION_COMMAND_NAMES.searchPage,
      id: createNotionIntentId({
        commandName: NOTION_COMMAND_NAMES.searchPage,
        query: trimmedQuery
      }),
      kind: "plugin" as const,
      openOptions: {
        seedQuery: trimmedQuery
      },
      presentation: createNotionPresentation(copy, "Search Notion"),
      priority: 125,
      subtitle: "Search pages and data sources in Notion.",
      title: "Search Notion"
    }
  ]
}

function createDatabasePageIntent(copy: NotionSearchCopy, query: string) {
  const trimmedQuery = query.trim()
  const normalizedQuery = normalizeQuery(query)

  if (
    !hasNotionSubject(normalizedQuery) ||
    !hasAnyTerm(normalizedQuery, ["create", "new", "新增", "新建", "创建"]) ||
    !hasAnyTerm(normalizedQuery, ["page", "页面", "database", "数据库"])
  ) {
    return []
  }

  return [
    {
      commandName: NOTION_COMMAND_NAMES.createDatabasePage,
      id: createNotionIntentId({
        commandName: NOTION_COMMAND_NAMES.createDatabasePage,
        query: trimmedQuery
      }),
      kind: "plugin" as const,
      openOptions: {
        seedQuery: trimmedQuery
      },
      presentation: createNotionPresentation(copy, "Create Page"),
      priority: 120,
      subtitle: "Create a page in a Notion data source.",
      title: "Create Page"
    }
  ]
}

function createQuickCaptureIntent(copy: NotionSearchCopy, query: string) {
  const trimmedQuery = query.trim()
  const normalizedQuery = normalizeQuery(query)
  const url = extractUrl(trimmedQuery)

  if (
    !hasNotionSubject(normalizedQuery) ||
    !hasAnyTerm(normalizedQuery, ["capture", "clip", "save", "保存", "收藏", "剪藏", "捕获"])
  ) {
    return []
  }

  return [
    {
      commandName: NOTION_COMMAND_NAMES.quickCapture,
      id: createNotionIntentId({
        commandName: NOTION_COMMAND_NAMES.quickCapture,
        query: trimmedQuery
      }),
      kind: "plugin" as const,
      openOptions: url
        ? {
            launchProps: {
              fallbackText: url
            },
            seedQuery: trimmedQuery
          }
        : {
            seedQuery: trimmedQuery
          },
      presentation: createNotionPresentation(copy, "Capture"),
      priority: 115,
      subtitle: "Capture a URL into a Notion page or data source.",
      title: "Quick Capture"
    }
  ]
}

function createAddTextIntent(copy: NotionSearchCopy, query: string) {
  const trimmedQuery = query.trim()
  const normalizedQuery = normalizeQuery(query)

  if (
    !hasNotionSubject(normalizedQuery) ||
    !hasAnyTerm(normalizedQuery, ["add text", "append", "prepend", "追加", "写入", "添加内容", "添加文字"])
  ) {
    return []
  }

  return [
    {
      commandName: NOTION_COMMAND_NAMES.addTextToPage,
      id: createNotionIntentId({
        commandName: NOTION_COMMAND_NAMES.addTextToPage,
        query: trimmedQuery
      }),
      kind: "plugin" as const,
      openOptions: {
        seedQuery: trimmedQuery
      },
      presentation: createNotionPresentation(copy, "Add Text"),
      priority: 110,
      subtitle: "Append or prepend text to a Notion page.",
      title: "Add Text to Page"
    }
  ]
}

const search = {
  buildIntentItems: ({ copy, query }: { copy: NotionSearchCopy; query: string }) => [
    ...createSearchNotionIntent(copy, query),
    ...createDatabasePageIntent(copy, query),
    ...createQuickCaptureIntent(copy, query),
    ...createAddTextIntent(copy, query)
  ],
  resolveCommand: ({
    altKey,
    ctrlKey,
    key,
    metaKey,
    query
  }: {
    altKey: boolean
    ctrlKey: boolean
    key: string
    metaKey: boolean
    query: string
  }) => {
    if (altKey || ctrlKey || metaKey || key !== " ") {
      return null
    }

    const normalizedQuery = normalizeQuery(query)
    const matchedConfig = notionCommandAliases.find((config) =>
      matchesNotionCommandAlias(normalizedQuery, config)
    )

    if (!matchedConfig) {
      return null
    }

    return {
      commandName: matchedConfig.commandName,
      openOptions: {
        seedQuery: ""
      }
    }
  }
}

export const notionRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: NOTION_COMMAND_NAMES.addTextToPage
    },
    {
      name: NOTION_COMMAND_NAMES.createDatabasePage
    },
    {
      name: NOTION_COMMAND_NAMES.quickCapture
    },
    {
      name: NOTION_COMMAND_NAMES.searchPage,
      search
    }
  ],
  extensionName: NOTION_EXTENSION_ID
})
