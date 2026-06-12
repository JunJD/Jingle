import type { LauncherSearchAction } from "./launcher-search"
import type { ExtensionRuntimeLaunchProps } from "./extension-runtime-protocol"

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

  if (url.protocol !== "openwork:" || url.hostname !== "extensions") {
    return null
  }

  const pathSegments = url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .filter(Boolean)

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

function readLaunchContext(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
