import type { LauncherSearchAction } from "./launcher-search"
import {
  normalizeExtensionRuntimeJsonFact,
  type ExtensionRuntimeJsonObject,
  type ExtensionRuntimeLaunchProps
} from "./extension-runtime-protocol"

export interface ExtensionQuicklinkShortcut {
  key: string
  modifiers: string[]
  platform: "macOS" | "Windows"
}

export interface ExtensionQuicklinkRecord {
  createdAt: string
  extensionName?: string
  id: string
  link: string
  name: string
  shortcut?: ExtensionQuicklinkShortcut
  updatedAt: string
}

export interface RegisterExtensionQuicklinkInput {
  extensionName: string
  link: string
  name?: string
  shortcut?: ExtensionQuicklinkShortcut
}

export interface UpdateExtensionQuicklinkInput {
  name: string
}

export interface ParsedExtensionQuicklinkCommand {
  commandName: string
  extensionName: string
  launchProps?: ExtensionRuntimeLaunchProps
}

interface RawExtensionQuicklinkCommand {
  commandName: string
  extensionName: string
}

const EXTENSION_QUICKLINK_PROTOCOL = "jingle:"

export function parseExtensionQuicklinkCommandUrl(
  link: string
): ParsedExtensionQuicklinkCommand | null {
  const parsed = parseRawExtensionQuicklinkCommandUrl(link)
  if (!parsed) {
    return null
  }

  const launchContext = readLaunchContext(parsed.url.searchParams.get("launchContext"))
  return {
    commandName: parsed.commandName,
    extensionName: parsed.extensionName,
    ...(launchContext ? { launchProps: { launchContext } } : {})
  }
}

export function normalizeExtensionQuicklinkCommandUrl(link: string): string {
  const parsed = parseRawExtensionQuicklinkCommandUrl(link)
  if (!parsed) {
    return link
  }
  parsed.url.protocol = EXTENSION_QUICKLINK_PROTOCOL
  return parsed.url.toString()
}

export function normalizeExtensionQuicklinkRecord(
  quicklink: ExtensionQuicklinkRecord
): ExtensionQuicklinkRecord {
  const link = normalizeExtensionQuicklinkCommandUrl(quicklink.link)
  const extensionName = parseExtensionQuicklinkCommandUrl(link)?.extensionName
  if (link === quicklink.link && (!extensionName || extensionName === quicklink.extensionName)) {
    return quicklink
  }

  return {
    ...quicklink,
    ...(extensionName ? { extensionName } : {}),
    link
  }
}

function parseRawExtensionQuicklinkCommandUrl(
  link: string
): (RawExtensionQuicklinkCommand & { url: URL }) | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }

  if (!isExtensionQuicklinkProtocol(url.protocol) || url.hostname !== "extensions") {
    return null
  }

  const pathSegments = url.pathname.split("/").flatMap((segment) => {
    const decodedSegment = decodeURIComponent(segment)
    return decodedSegment ? [decodedSegment] : []
  })

  const [firstSegment, secondSegment, thirdSegment] = pathSegments
  const extensionName = thirdSegment ? secondSegment : firstSegment
  const commandName = thirdSegment ?? secondSegment
  if (!extensionName || !commandName) {
    return null
  }

  return {
    commandName,
    extensionName,
    url
  }
}

function isExtensionQuicklinkProtocol(protocol: string): boolean {
  return protocol === EXTENSION_QUICKLINK_PROTOCOL
}

export function createExtensionQuicklinkAction(
  quicklink: ExtensionQuicklinkRecord
): LauncherSearchAction {
  const command = parseExtensionQuicklinkCommandUrl(quicklink.link)
  if (command) {
    return {
      executor: "internal",
      target: command,
      type: "open-extension-command"
    }
  }

  return {
    executor: "shell",
    target: {
      url: quicklink.link
    },
    type: "open-url"
  }
}

function readLaunchContext(value: string | null): ExtensionRuntimeJsonObject | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    const normalized = normalizeExtensionRuntimeJsonFact(
      parsed,
      "extension quicklink launchContext"
    )
    return normalized && typeof normalized === "object" && !Array.isArray(normalized)
      ? (normalized as ExtensionRuntimeJsonObject)
      : null
  } catch {
    return null
  }
}
