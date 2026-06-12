import { randomUUID } from "node:crypto"
import Store from "electron-store"
import type {
  ExtensionQuicklinkRecord,
  RegisterExtensionQuicklinkInput,
  UpdateExtensionQuicklinkInput
} from "@shared/extension-quicklinks"
import {
  normalizeExtensionQuicklinkCommandUrl,
  parseExtensionQuicklinkCommandUrl
} from "@shared/extension-quicklinks"
import { getOpenworkDir } from "../storage"

interface ExtensionQuicklinksStoreShape {
  quicklinks: ExtensionQuicklinkRecord[]
}

function isExtensionQuicklinkRecord(value: unknown): value is ExtensionQuicklinkRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "link" in value &&
    "name" in value &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { link?: unknown }).link === "string" &&
    typeof (value as { name?: unknown }).name === "string"
  )
}

export class ExtensionQuicklinkRepository {
  private readonly knownExtensionNames: ReadonlySet<string>

  constructor(extensionNames: readonly string[] = []) {
    this.knownExtensionNames = new Set(extensionNames)
  }

  private readonly store = new Store<ExtensionQuicklinksStoreShape>({
    cwd: getOpenworkDir(),
    defaults: {
      quicklinks: []
    },
    name: "extension-quicklinks"
  })

  list(): ExtensionQuicklinkRecord[] {
    return this.readQuicklinks().sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  }

  register(input: RegisterExtensionQuicklinkInput): ExtensionQuicklinkRecord {
    const now = new Date().toISOString()
    const quicklinks = this.readQuicklinks()
    const name = input.name?.trim() || "Quicklink"
    const link = normalizeExtensionQuicklinkCommandUrl(input.link)
    const extensionName =
      parseExtensionQuicklinkCommandUrl(link)?.extensionName ?? input.extensionName
    this.assertKnownExtensionName(extensionName)
    const existingIndex = quicklinks.findIndex((quicklink) => quicklink.link === link)

    if (existingIndex >= 0) {
      const nextQuicklink: ExtensionQuicklinkRecord = {
        ...quicklinks[existingIndex],
        extensionName,
        name,
        shortcut: input.shortcut,
        updatedAt: now
      }
      const nextQuicklinks = [...quicklinks]
      nextQuicklinks[existingIndex] = nextQuicklink
      this.writeQuicklinks(nextQuicklinks)
      return nextQuicklink
    }

    const nextQuicklink: ExtensionQuicklinkRecord = {
      createdAt: now,
      extensionName,
      id: randomUUID(),
      link,
      name,
      shortcut: input.shortcut,
      updatedAt: now
    }
    this.writeQuicklinks([...quicklinks, nextQuicklink])
    return nextQuicklink
  }

  remove(quicklinkId: string): void {
    this.writeQuicklinks(this.readQuicklinks().filter((quicklink) => quicklink.id !== quicklinkId))
  }

  update(quicklinkId: string, input: UpdateExtensionQuicklinkInput): ExtensionQuicklinkRecord {
    const quicklinks = this.readQuicklinks()
    const quicklinkIndex = quicklinks.findIndex((quicklink) => quicklink.id === quicklinkId)
    if (quicklinkIndex < 0) {
      throw new Error(`Extension quicklink not found: ${quicklinkId}`)
    }

    const nextQuicklink: ExtensionQuicklinkRecord = {
      ...quicklinks[quicklinkIndex],
      name: input.name.trim() || "Quicklink",
      updatedAt: new Date().toISOString()
    }
    const nextQuicklinks = [...quicklinks]
    nextQuicklinks[quicklinkIndex] = nextQuicklink
    this.writeQuicklinks(nextQuicklinks)
    return nextQuicklink
  }

  private readQuicklinks(): ExtensionQuicklinkRecord[] {
    const quicklinks = (this.store.get("quicklinks", []) as unknown[]).filter(
      isExtensionQuicklinkRecord
    )
    const normalizedQuicklinks = dedupeQuicklinksByLink(quicklinks).filter((quicklink) =>
      this.isCurrentExtensionQuicklink(quicklink)
    )
    if (
      normalizedQuicklinks.length !== quicklinks.length ||
      normalizedQuicklinks.some(
        (quicklink, index) =>
          quicklink.link !== quicklinks[index]?.link ||
          quicklink.extensionName !== quicklinks[index]?.extensionName
      )
    ) {
      this.writeQuicklinks(normalizedQuicklinks)
    }
    return normalizedQuicklinks
  }

  private writeQuicklinks(quicklinks: ExtensionQuicklinkRecord[]): void {
    this.store.set("quicklinks", quicklinks)
  }

  private assertKnownExtensionName(extensionName: string): void {
    if (this.knownExtensionNames.size > 0 && !this.knownExtensionNames.has(extensionName)) {
      throw new Error(`Unknown native extension "${extensionName}".`)
    }
  }

  private isCurrentExtensionQuicklink(quicklink: ExtensionQuicklinkRecord): boolean {
    if (this.knownExtensionNames.size === 0) {
      return true
    }

    const command = parseExtensionQuicklinkCommandUrl(quicklink.link)
    if (!command) {
      return true
    }

    return this.knownExtensionNames.has(command.extensionName)
  }
}

function dedupeQuicklinksByLink(
  quicklinks: ExtensionQuicklinkRecord[]
): ExtensionQuicklinkRecord[] {
  const quicklinksByLink = new Map<string, ExtensionQuicklinkRecord>()

  for (const quicklink of quicklinks) {
    const existing = quicklinksByLink.get(quicklink.link)
    if (!existing || quicklink.updatedAt.localeCompare(existing.updatedAt) > 0) {
      quicklinksByLink.set(quicklink.link, quicklink)
    }
  }

  return [...quicklinksByLink.values()]
}
