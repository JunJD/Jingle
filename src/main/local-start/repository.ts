import { randomUUID } from "node:crypto"
import Store from "electron-store"
import type { CreateLocalStartItemInput, LocalStartItem } from "@shared/local-start"
import { getOpenworkDir } from "../storage"

interface LocalStartStoreShape {
  items: LocalStartItem[]
}

export class LocalStartRepository {
  private readonly store = new Store<LocalStartStoreShape>({
    name: "local-start",
    cwd: getOpenworkDir(),
    defaults: {
      items: []
    }
  })

  list(): LocalStartItem[] {
    return this.sortItems(this.readItems())
  }

  getById(itemId: string): LocalStartItem | null {
    return this.readItems().find((item) => item.id === itemId) ?? null
  }

  upsert(input: CreateLocalStartItemInput): LocalStartItem {
    const now = new Date().toISOString()
    const items = this.readItems()
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
      this.writeItems(nextItems)
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

    this.writeItems([...items, nextItem])
    return nextItem
  }

  remove(itemId: string): void {
    this.writeItems(this.readItems().filter((item) => item.id !== itemId))
  }

  recordUse(itemId: string): LocalStartItem {
    const items = this.readItems()
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
    this.writeItems(nextItems)
    return nextItem
  }

  private readItems(): LocalStartItem[] {
    return this.store.get("items", [])
  }

  private writeItems(items: LocalStartItem[]): void {
    this.store.set("items", items)
  }

  private sortItems(items: LocalStartItem[]): LocalStartItem[] {
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
}
