import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"
import { EXTENSION_ICON, EXTENSION_ID, EXTENSION_SUBJECT_TERMS } from "./identity"

interface GeneratedSearchCopy {
  launcher: {
    openGeneric: string
    resultKindExtension: string
  }
}

interface GeneratedCommandSearchConfig {
  aliases: string[]
  commandName: string
  primaryActionLabel: string
  priority: number
  subtitle: string
  terms: string[]
  title: string
  urlFallback: boolean
}

const commandSearchConfigs: GeneratedCommandSearchConfig[] = [
  {
    aliases: ["index", "search files"],
    commandName: "index",
    primaryActionLabel: "Search Files",
    priority: 120,
    subtitle: "Lists Figma files allowing you to search and navigate to them.",
    terms: ["index", "search files", "search", "find", "look up", "搜索", "查找", "查询"],
    title: "Search Files",
    urlFallback: false
  },
  {
    aliases: ["menu-bar", "menu bar", "quicklook"],
    commandName: "menu-bar",
    primaryActionLabel: "Quicklook",
    priority: 115,
    subtitle: "See your Figma most recent files at a glance",
    terms: ["menu-bar", "menu bar", "quicklook"],
    title: "Quicklook",
    urlFallback: false
  }
]

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function hasAnyTerm(query: string, terms: readonly string[]): boolean {
  return terms.some((term) => query.includes(term))
}

function extractUrl(query: string): string | null {
  return query.match(/https?:\/\/\S+/i)?.[0] ?? null
}

function hasExtensionSubject(query: string): boolean {
  return hasAnyTerm(query, EXTENSION_SUBJECT_TERMS)
}

function matchesCommandAlias(query: string, config: GeneratedCommandSearchConfig): boolean {
  return EXTENSION_SUBJECT_TERMS.some((subject) =>
    config.aliases.some(
      (alias) => query === `${subject} ${alias}` || query === `${alias} ${subject}`
    )
  )
}

function createExtensionIcon() {
  if (EXTENSION_ICON) {
    return {
      extensionName: EXTENSION_ID,
      icon: EXTENSION_ICON,
      type: "extension" as const
    }
  }

  return {
    extensionName: EXTENSION_ID,
    type: "extension" as const
  }
}

function createPresentation(copy: GeneratedSearchCopy, primaryActionLabel: string) {
  return {
    categoryLabel: copy.launcher.resultKindExtension,
    icon: createExtensionIcon(),
    listActionLabel: copy.launcher.openGeneric,
    primaryActionLabel,
    tone: "accent" as const
  }
}

const search = {
  buildIntentItems: ({ copy, query }: { copy: GeneratedSearchCopy; query: string }) => {
    const trimmedQuery = query.trim()
    const normalizedQuery = normalizeQuery(query)

    if (!trimmedQuery || !hasExtensionSubject(normalizedQuery)) {
      return []
    }

    return commandSearchConfigs.flatMap((config) => {
      if (!hasAnyTerm(normalizedQuery, config.terms)) {
        return []
      }

      const url = config.urlFallback ? extractUrl(trimmedQuery) : null

      return [
        {
          commandName: config.commandName,
          id: `${EXTENSION_ID}:${config.commandName}:intent:${trimmedQuery}`,
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
          presentation: createPresentation(copy, config.primaryActionLabel),
          priority: config.priority,
          subtitle: config.subtitle,
          title: config.title
        }
      ]
    })
  },
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
    const matchedConfig = commandSearchConfigs.find((config) =>
      matchesCommandAlias(normalizedQuery, config)
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

export const figmaFilesRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: "index",
      search
    },
    {
      name: "menu-bar"
    }
  ],
  extensionName: EXTENSION_ID
})
