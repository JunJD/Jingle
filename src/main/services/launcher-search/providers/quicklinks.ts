import {
  createExtensionQuicklinkAction,
  normalizeExtensionQuicklinkRecord,
  type ExtensionQuicklinkAlias,
  type ExtensionQuicklinkRecord
} from "@shared/extension-quicklinks"
import type { LauncherSearchRequest } from "@shared/launcher-search"
import type { LauncherSearchProvider, LauncherSearchProviderResponse } from "../types"

let listQuicklinks: (() => ExtensionQuicklinkRecord[]) | null = null
let extensionQuicklinkAliases: readonly ExtensionQuicklinkAlias[] = []

export function configureQuicklinksLauncherSearchProvider(params: {
  aliases?: readonly ExtensionQuicklinkAlias[]
  listQuicklinks: () => ExtensionQuicklinkRecord[]
}): void {
  extensionQuicklinkAliases = params.aliases ?? []
  listQuicklinks = params.listQuicklinks
}

function normalizeQuicklinkSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function scoreQuicklink(quicklink: ExtensionQuicklinkRecord, query: string): number | null {
  const normalizedName = normalizeQuicklinkSearchText(quicklink.name)
  const normalizedLink = normalizeQuicklinkSearchText(quicklink.link)
  const normalizedExtension = normalizeQuicklinkSearchText(quicklink.extensionName ?? "")

  if (normalizedName === query) {
    return 860
  }

  if (normalizedName.startsWith(query)) {
    return 780
  }

  if (normalizedName.includes(query)) {
    return 650
  }

  if (normalizedExtension && normalizedExtension.includes(query)) {
    return 520
  }

  if (normalizedLink.includes(query)) {
    return 420
  }

  return null
}

class QuicklinksLauncherSearchProvider implements LauncherSearchProvider {
  readonly source = "quicklinks" as const

  async search(request: LauncherSearchRequest): Promise<LauncherSearchProviderResponse> {
    const query = normalizeQuicklinkSearchText(request.query)
    if (!query || !listQuicklinks) {
      return { results: [] }
    }

    return {
      results: listQuicklinks()
        .map((quicklink) => {
          const normalizedQuicklink = normalizeExtensionQuicklinkRecord(quicklink, {
            aliases: extensionQuicklinkAliases
          })
          return {
            quicklink: normalizedQuicklink,
            score: scoreQuicklink(normalizedQuicklink, query)
          }
        })
        .filter(
          (entry): entry is { quicklink: ExtensionQuicklinkRecord; score: number } =>
            entry.score !== null
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(request.limit, 1))
        .map(({ quicklink, score }) => ({
          action: createExtensionQuicklinkAction(quicklink, {
            aliases: extensionQuicklinkAliases
          }),
          id: quicklink.id,
          kind: "url" as const,
          score,
          source: "quicklinks" as const,
          subtitle: quicklink.extensionName
            ? `${quicklink.extensionName} · ${quicklink.link}`
            : quicklink.link,
          title: quicklink.name
        }))
    }
  }
}

export const quicklinksLauncherSearchProvider = new QuicklinksLauncherSearchProvider()
