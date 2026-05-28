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

export interface ParsedExtensionQuicklinkCommand {
  commandName: string
  extensionName: string
  launchProps?: ExtensionRuntimeLaunchProps
}

export function parseExtensionQuicklinkCommandUrl(
  link: string
): ParsedExtensionQuicklinkCommand | null {
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

  const launchContext = readLaunchContext(url.searchParams.get("launchContext"))
  return {
    commandName,
    extensionName,
    ...(launchContext ? { launchProps: { launchContext } } : {})
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
