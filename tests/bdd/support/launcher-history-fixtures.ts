import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { LauncherHistoryItem } from "../../../src/shared/launcher-history"

function createHistoryItem(params: {
  lastUsedAt: string
  jingleHome: string
  pin: boolean
  title: string
}): LauncherHistoryItem {
  const path = join(params.jingleHome, params.title)

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
  jingleHome: string
}): void {
  const items = params.items.map((item) =>
    createHistoryItem({
      lastUsedAt: item.lastUsedAt,
      jingleHome: params.jingleHome,
      pin: item.pin ?? false,
      title: item.title
    })
  )

  mkdirSync(params.jingleHome, { recursive: true })
  writeFileSync(join(params.jingleHome, "launcher-history.json"), JSON.stringify({ items }))
}
