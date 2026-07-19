import { randomUUID } from "node:crypto"
import Store from "electron-store"
import type { LauncherHistoryItem, RecordLauncherHistoryItemInput } from "@shared/launcher-history"
import { createLauncherHistoryKey, sortLauncherHistoryItems } from "@shared/launcher-history"
import { getJingleHomeDir } from "../storage"
import {
  getApplicationDisplayName,
  getApplicationIconDataUrl,
  getApplicationSubtitle,
  getWindowsPackagedApplicationIdForPath
} from "../services/launcher-search/providers/applications"

interface LauncherHistoryStoreShape {
  items: LauncherHistoryItem[]
}

export interface LauncherHistoryStoreAdapter {
  get(key: "items", defaultValue: LauncherHistoryItem[]): unknown
  set(key: "items", value: LauncherHistoryItem[]): void
}

export interface LauncherHistoryRepositoryOptions {
  applicationIconResolver?: (applicationIdentity: string) => Promise<string | undefined>
  applicationNameResolver?: (applicationIdentity: string) => Promise<string | undefined>
  applicationSubtitleResolver?: (applicationIdentity: string) => Promise<string | undefined>
  canonicalApplicationResolver?: (applicationPath: string) => Promise<string | undefined>
  store?: LauncherHistoryStoreAdapter
}

interface EnrichedLauncherHistoryItem {
  hasCanonicalPackagedMetadata: boolean
  item: LauncherHistoryItem
}

function hasLauncherHistoryKey(value: unknown): value is LauncherHistoryItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "historyKey" in value &&
    typeof (value as { historyKey?: unknown }).historyKey === "string" &&
    (value as { historyKey: string }).historyKey.length > 0
  )
}

export class LauncherHistoryRepository {
  private readonly applicationIconResolver: NonNullable<
    LauncherHistoryRepositoryOptions["applicationIconResolver"]
  >
  private readonly applicationNameResolver: NonNullable<
    LauncherHistoryRepositoryOptions["applicationNameResolver"]
  >
  private readonly applicationSubtitleResolver: NonNullable<
    LauncherHistoryRepositoryOptions["applicationSubtitleResolver"]
  >
  private readonly canonicalApplicationResolver: NonNullable<
    LauncherHistoryRepositoryOptions["canonicalApplicationResolver"]
  >
  private readonly store: LauncherHistoryStoreAdapter

  constructor(options: LauncherHistoryRepositoryOptions = {}) {
    this.applicationIconResolver = options.applicationIconResolver ?? getApplicationIconDataUrl
    this.applicationNameResolver = options.applicationNameResolver ?? getApplicationDisplayName
    this.applicationSubtitleResolver = options.applicationSubtitleResolver ?? getApplicationSubtitle
    this.canonicalApplicationResolver =
      options.canonicalApplicationResolver ?? getWindowsPackagedApplicationIdForPath
    this.store = options.store ?? createStore()
  }

  async list(): Promise<LauncherHistoryItem[]> {
    const storedItems = this.readStoredItems()
    const items = this.readItems(storedItems)
    const enrichedEntries = await Promise.all(
      items.map(async (item): Promise<EnrichedLauncherHistoryItem> => {
        return {
          hasCanonicalPackagedMetadata: isCanonicalPackagedHistoryItem(item),
          item: await this.enrichItem(item)
        }
      })
    )
    const mergedItems = mergeLauncherHistoryItems(enrichedEntries)

    if (
      storedItems.length !== items.length ||
      mergedItems.length !== items.length ||
      mergedItems.some((item, index) => item !== items[index])
    ) {
      this.writeItems(mergedItems)
    }

    return sortLauncherHistoryItems(mergedItems)
  }

  record(input: RecordLauncherHistoryItemInput): LauncherHistoryItem {
    const now = new Date().toISOString()
    const items = this.readItems()
    const existingIndex = items.findIndex((item) => item.historyKey === input.historyKey)

    if (existingIndex >= 0) {
      const nextItem: LauncherHistoryItem = {
        ...items[existingIndex],
        action: input.action,
        kind: input.kind,
        iconDataUrl: input.iconDataUrl,
        subtitle: input.subtitle,
        title: input.title,
        updatedAt: now,
        useCount: items[existingIndex].useCount + 1,
        lastUsedAt: now
      }
      const nextItems = [...items]
      nextItems[existingIndex] = nextItem
      this.writeItems(nextItems)
      return nextItem
    }

    const nextItem: LauncherHistoryItem = {
      id: randomUUID(),
      historyKey: input.historyKey,
      kind: input.kind,
      title: input.title,
      subtitle: input.subtitle,
      iconDataUrl: input.iconDataUrl,
      action: input.action,
      pin: false,
      useCount: 1,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    }

    this.writeItems([...items, nextItem])
    return nextItem
  }

  remove(itemId: string): void {
    this.writeItems(this.readItems().filter((item) => item.id !== itemId))
  }

  setPinned(itemId: string, pin: boolean): LauncherHistoryItem {
    const items = this.readItems()
    const itemIndex = items.findIndex((item) => item.id === itemId)

    if (itemIndex < 0) {
      throw new Error(`Launcher history item not found: ${itemId}`)
    }

    const now = new Date().toISOString()
    const nextItem: LauncherHistoryItem = {
      ...items[itemIndex],
      pin,
      updatedAt: now
    }
    const nextItems = [...items]
    nextItems[itemIndex] = nextItem
    this.writeItems(nextItems)
    return nextItem
  }

  private readStoredItems(): unknown[] {
    return this.store.get("items", []) as unknown[]
  }

  private readItems(storedItems: unknown[] = this.readStoredItems()): LauncherHistoryItem[] {
    return storedItems.filter(hasLauncherHistoryKey)
  }

  private writeItems(items: LauncherHistoryItem[]): void {
    this.store.set("items", items)
  }

  private async enrichItem(item: LauncherHistoryItem): Promise<LauncherHistoryItem> {
    if (item.kind !== "application") {
      return item
    }

    const originalHistoryKey = getCanonicalApplicationHistoryKey(item)
    let applicationIdentity: string | null = null
    let migratedToPackagedApplication = false
    let nextItem = item

    if (item.action.type === "open-path" && item.action.target.kind === "application") {
      applicationIdentity = item.action.target.path
      const shouldResolveCanonicalApplication =
        !item.action.localStartItemId && item.historyKey === originalHistoryKey
      const appUserModelId = shouldResolveCanonicalApplication
        ? await this.canonicalApplicationResolver(applicationIdentity)
        : undefined
      if (appUserModelId) {
        applicationIdentity = appUserModelId
        migratedToPackagedApplication = true
        nextItem = {
          ...item,
          action: {
            executor: "shell",
            target: { appUserModelId },
            type: "launch-windows-packaged-application"
          },
          historyKey: createLauncherHistoryKey({
            appUserModelId,
            type: "windows-packaged-application"
          })
        }
      }
    } else if (item.action.type === "launch-windows-packaged-application") {
      applicationIdentity = item.action.target.appUserModelId
    }

    if (!applicationIdentity) {
      return nextItem
    }

    const shouldRefreshTitle = item.historyKey === originalHistoryKey
    const shouldRefreshPackagedSubtitle =
      nextItem.action.type === "launch-windows-packaged-application" && shouldRefreshTitle
    const [resolvedIconDataUrl, displayName, resolvedSubtitle] = await Promise.all([
      nextItem.iconDataUrl && !migratedToPackagedApplication
        ? Promise.resolve(nextItem.iconDataUrl)
        : this.applicationIconResolver(applicationIdentity),
      shouldRefreshTitle
        ? this.applicationNameResolver(applicationIdentity)
        : Promise.resolve(undefined),
      shouldRefreshPackagedSubtitle
        ? this.applicationSubtitleResolver(applicationIdentity)
        : Promise.resolve(undefined)
    ])
    const iconDataUrl = resolvedIconDataUrl ?? nextItem.iconDataUrl
    const subtitle =
      resolvedSubtitle ?? (migratedToPackagedApplication ? applicationIdentity : nextItem.subtitle)

    if (
      nextItem === item &&
      iconDataUrl === item.iconDataUrl &&
      (!displayName || displayName === item.title) &&
      subtitle === item.subtitle
    ) {
      return item
    }

    return {
      ...nextItem,
      ...(iconDataUrl ? { iconDataUrl } : {}),
      ...(displayName ? { title: displayName } : {}),
      subtitle
    }
  }
}

function createStore(): LauncherHistoryStoreAdapter {
  return new Store<LauncherHistoryStoreShape>({
    name: "launcher-history",
    cwd: getJingleHomeDir(),
    defaults: {
      items: []
    }
  })
}

function getCanonicalApplicationHistoryKey(item: LauncherHistoryItem): string | null {
  if (item.action.type === "open-path" && item.action.target.kind === "application") {
    return createLauncherHistoryKey({
      path: item.action.target.path,
      type: "application"
    })
  }

  if (item.action.type === "launch-windows-packaged-application") {
    return createLauncherHistoryKey({
      appUserModelId: item.action.target.appUserModelId,
      type: "windows-packaged-application"
    })
  }

  return null
}

function isCanonicalPackagedHistoryItem(item: LauncherHistoryItem): boolean {
  return (
    item.action.type === "launch-windows-packaged-application" &&
    item.historyKey === getCanonicalApplicationHistoryKey(item)
  )
}

function mergeLauncherHistoryItems(entries: EnrichedLauncherHistoryItem[]): LauncherHistoryItem[] {
  const entriesByHistoryKey = new Map<string, EnrichedLauncherHistoryItem[]>()

  for (const entry of entries) {
    const matchingEntries = entriesByHistoryKey.get(entry.item.historyKey)
    if (matchingEntries) {
      matchingEntries.push(entry)
    } else {
      entriesByHistoryKey.set(entry.item.historyKey, [entry])
    }
  }

  return Array.from(entriesByHistoryKey.entries(), ([historyKey, matchingEntries]) => {
    if (matchingEntries.length === 1) {
      return matchingEntries[0]!.item
    }

    return mergeLauncherHistoryItemGroup(historyKey, matchingEntries)
  })
}

function mergeLauncherHistoryItemGroup(
  historyKey: string,
  entries: EnrichedLauncherHistoryItem[]
): LauncherHistoryItem {
  const items = entries.map((entry) => entry.item)
  const itemsByRecency = items.toSorted(compareLauncherHistoryItemRecency)
  const metadataItemsByPriority = [
    ...entries
      .filter((entry) => entry.hasCanonicalPackagedMetadata)
      .map((entry) => entry.item)
      .toSorted(compareLauncherHistoryItemRecency),
    ...entries
      .filter((entry) => !entry.hasCanonicalPackagedMetadata)
      .map((entry) => entry.item)
      .toSorted(compareLauncherHistoryItemRecency)
  ]
  const latestItem = itemsByRecency[0]!
  const canonicalItem =
    itemsByRecency.find((item) => getCanonicalApplicationHistoryKey(item) === historyKey) ??
    latestItem
  const iconDataUrl = findLatestNonEmptyMetadata(
    metadataItemsByPriority,
    (item) => item.iconDataUrl
  )
  const mergedItem: LauncherHistoryItem = {
    ...latestItem,
    action: canonicalItem.action,
    createdAt: findEarliestTimestamp(items, (item) => item.createdAt),
    historyKey,
    lastUsedAt: findLatestTimestamp(items, (item) => item.lastUsedAt),
    pin: items.some((item) => item.pin),
    subtitle:
      findLatestNonEmptyMetadata(metadataItemsByPriority, (item) => item.subtitle) ??
      latestItem.subtitle,
    title:
      findLatestNonEmptyMetadata(metadataItemsByPriority, (item) => item.title) ?? latestItem.title,
    updatedAt: findLatestTimestamp(items, (item) => item.updatedAt),
    useCount: items.reduce((total, item) => total + item.useCount, 0)
  }

  if (iconDataUrl) {
    mergedItem.iconDataUrl = iconDataUrl
  } else {
    delete mergedItem.iconDataUrl
  }

  return mergedItem
}

function compareLauncherHistoryItemRecency(
  left: LauncherHistoryItem,
  right: LauncherHistoryItem
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.lastUsedAt.localeCompare(left.lastUsedAt) ||
    right.createdAt.localeCompare(left.createdAt)
  )
}

function findLatestNonEmptyMetadata(
  itemsByRecency: LauncherHistoryItem[],
  selectValue: (item: LauncherHistoryItem) => string | undefined
): string | undefined {
  for (const item of itemsByRecency) {
    const value = selectValue(item)
    if (value?.trim()) {
      return value
    }
  }

  return undefined
}

function findEarliestTimestamp(
  items: LauncherHistoryItem[],
  selectTimestamp: (item: LauncherHistoryItem) => string
): string {
  return items.reduce((earliest, item) => {
    const timestamp = selectTimestamp(item)
    return timestamp.localeCompare(earliest) < 0 ? timestamp : earliest
  }, selectTimestamp(items[0]!))
}

function findLatestTimestamp(
  items: LauncherHistoryItem[],
  selectTimestamp: (item: LauncherHistoryItem) => string
): string {
  return items.reduce((latest, item) => {
    const timestamp = selectTimestamp(item)
    return timestamp.localeCompare(latest) > 0 ? timestamp : latest
  }, selectTimestamp(items[0]!))
}
