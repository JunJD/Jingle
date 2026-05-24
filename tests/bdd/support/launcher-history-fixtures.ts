import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { LauncherHistoryItem } from "../../../src/shared/launcher-history"

function createHistoryItem(params: {
  lastUsedAt: string
  openworkHome: string
  pin: boolean
  title: string
}): LauncherHistoryItem {
  const path = join(params.openworkHome, params.title)

  return {
    id: randomUUID(),
    historyKey: `directory:${path}`,
    kind: "directory",
    title: params.title,
    subtitle: path,
    action: {
      executor: "shell",
      target: {
        kind: "directory",
        path
      },
      type: "open-path"
    },
    pin: params.pin,
    useCount: 1,
    createdAt: params.lastUsedAt,
    updatedAt: params.lastUsedAt,
    lastUsedAt: params.lastUsedAt
  }
}

export function seedLauncherHistoryFixture(params: {
  items: Array<{
    lastUsedAt: string
    pin?: boolean
    title: string
  }>
  openworkHome: string
}): void {
  const items = params.items.map((item) =>
    createHistoryItem({
      lastUsedAt: item.lastUsedAt,
      openworkHome: params.openworkHome,
      pin: item.pin ?? false,
      title: item.title
    })
  )

  mkdirSync(params.openworkHome, { recursive: true })
  writeFileSync(join(params.openworkHome, "launcher-history.json"), JSON.stringify({ items }))
}
