import Store from "electron-store"
import { randomUUID } from "node:crypto"
import { getOpenworkDir } from "../storage"
import type { CreateLocalStartItemInput, LocalStartItem } from "../../shared/local-start"

interface LocalStartStoreShape {
  items: LocalStartItem[]
}

const store = new Store<LocalStartStoreShape>({
  name: "local-start",
  cwd: getOpenworkDir(),
  defaults: {
    items: []
  }
})

function readItems(): LocalStartItem[] {
  return store.get("items", [])
}

function writeItems(items: LocalStartItem[]): void {
  store.set("items", items)
}

function sortItems(items: LocalStartItem[]): LocalStartItem[] {
  return [...items].sort((left, right) => {
    if (left.useCount !== right.useCount) {
      return right.useCount - left.useCount
    }

    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt)
    }

    return left.title.localeCompare(right.title)
  })
}

export function listLocalStartItems(): LocalStartItem[] {
  return sortItems(readItems())
}

export function upsertLocalStartItem(input: CreateLocalStartItemInput): LocalStartItem {
  const now = new Date().toISOString()
  const items = readItems()
  const existingIndex = items.findIndex(
    (item) => item.kind === input.kind && item.path === input.path
  )

  if (existingIndex >= 0) {
    const nextItem: LocalStartItem = {
      ...items[existingIndex],
      title: input.title,
      updatedAt: now
    }
    const nextItems = [...items]
    nextItems[existingIndex] = nextItem
    writeItems(nextItems)
    return nextItem
  }

  const nextItem: LocalStartItem = {
    id: randomUUID(),
    kind: input.kind,
    title: input.title,
    path: input.path,
    createdAt: now,
    updatedAt: now,
    useCount: 0,
    lastUsedAt: null
  }

  writeItems([...items, nextItem])
  return nextItem
}

export function removeLocalStartItem(itemId: string): void {
  const items = readItems()
  writeItems(items.filter((item) => item.id !== itemId))
}

export function getLocalStartItem(itemId: string): LocalStartItem | null {
  return readItems().find((item) => item.id === itemId) ?? null
}

export function recordLocalStartItemUse(itemId: string): LocalStartItem {
  const items = readItems()
  const itemIndex = items.findIndex((item) => item.id === itemId)

  if (itemIndex < 0) {
    throw new Error(`Local start item not found: ${itemId}`)
  }

  const now = new Date().toISOString()
  const nextItem: LocalStartItem = {
    ...items[itemIndex],
    useCount: items[itemIndex].useCount + 1,
    lastUsedAt: now,
    updatedAt: now
  }
  const nextItems = [...items]
  nextItems[itemIndex] = nextItem
  writeItems(nextItems)
  return nextItem
}
