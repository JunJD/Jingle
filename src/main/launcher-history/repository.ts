import { randomUUID } from "node:crypto"
import Store from "electron-store"
import type {
  LauncherHistoryItem,
  RecordLauncherHistoryItemInput
} from "@shared/launcher-history"
import { sortLauncherHistoryItems } from "@shared/launcher-history"
import { getOpenworkDir } from "../storage"
import { getApplicationIconDataUrl } from "../services/launcher-search/providers/applications"

interface LauncherHistoryStoreShape {
  items: LauncherHistoryItem[]
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
  private readonly store = new Store<LauncherHistoryStoreShape>({
    name: "launcher-history",
    cwd: getOpenworkDir(),
    defaults: {
      items: []
    }
  })

  async list(): Promise<LauncherHistoryItem[]> {
    const storedItems = this.readStoredItems()
    const items = this.readItems(storedItems)
    const enrichedItems = await Promise.all(items.map((item) => this.enrichItem(item)))

    if (
      storedItems.length !== items.length ||
      enrichedItems.some((item, index) => item !== items[index])
    ) {
      this.writeItems(enrichedItems)
    }

    return sortLauncherHistoryItems(enrichedItems)
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
    if (item.iconDataUrl || item.kind !== "application") {
      return item
    }

    const applicationPath =
      item.action.type === "open-path" && item.action.target.kind === "application"
        ? item.action.target.path
        : null

    if (!applicationPath) {
      return item
    }

    const iconDataUrl = await getApplicationIconDataUrl(applicationPath)
    if (!iconDataUrl) {
      return item
    }

    return {
      ...item,
      iconDataUrl
    }
  }
}
