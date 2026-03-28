import Store from "electron-store"
import { randomUUID } from "node:crypto"
import type {
  LauncherHistoryItem,
  RecordLauncherHistoryItemInput
} from "../../shared/launcher-history"
import { sortLauncherHistoryItems } from "../../shared/launcher-history"
import { getOpenworkDir } from "../storage"
import { getApplicationIconDataUrl } from "./launcher-search/providers/applications"

interface LauncherHistoryStoreShape {
  items: LauncherHistoryItem[]
}

const store = new Store<LauncherHistoryStoreShape>({
  name: "launcher-history",
  cwd: getOpenworkDir(),
  defaults: {
    items: []
  }
})

function readItems(): LauncherHistoryItem[] {
  return store.get("items", [])
}

function writeItems(items: LauncherHistoryItem[]): void {
  store.set("items", items)
}

async function enrichHistoryItem(item: LauncherHistoryItem): Promise<LauncherHistoryItem> {
  if (item.iconDataUrl || item.kind !== "application") {
    return item
  }

  const applicationPath =
    item.action.type === "launch-application"
      ? item.action.applicationPath
      : item.action.type === "open-local-start-item" && item.action.itemKind === "application"
        ? item.action.path
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

export async function listLauncherHistoryItems(): Promise<LauncherHistoryItem[]> {
  const items = readItems()
  const enrichedItems = await Promise.all(items.map((item) => enrichHistoryItem(item)))

  if (enrichedItems.some((item, index) => item !== items[index])) {
    writeItems(enrichedItems)
  }

  return sortLauncherHistoryItems(enrichedItems)
}

export function recordLauncherHistoryItem(
  input: RecordLauncherHistoryItemInput
): LauncherHistoryItem {
  const now = new Date().toISOString()
  const items = readItems()
  const existingIndex = items.findIndex((item) => item.dedupeKey === input.dedupeKey)

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
    writeItems(nextItems)
    return nextItem
  }

  const nextItem: LauncherHistoryItem = {
    id: randomUUID(),
    dedupeKey: input.dedupeKey,
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

  writeItems([...items, nextItem])
  return nextItem
}

export function removeLauncherHistoryItem(itemId: string): void {
  writeItems(readItems().filter((item) => item.id !== itemId))
}

export function setLauncherHistoryPinned(itemId: string, pin: boolean): LauncherHistoryItem {
  const items = readItems()
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
  writeItems(nextItems)
  return nextItem
}
