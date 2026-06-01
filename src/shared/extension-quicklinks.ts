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

export interface ExtensionQuicklinkAlias {
  fromExtensionName: string
  nameReplacements?: ReadonlyArray<{
    from: string
    to: string
  }>
  toExtensionName: string
}

export interface ExtensionQuicklinkParseOptions {
  aliases?: readonly ExtensionQuicklinkAlias[]
}

interface RawExtensionQuicklinkCommand {
  commandName: string
  extensionName: string
}

export function parseExtensionQuicklinkCommandUrl(
  link: string,
  options: ExtensionQuicklinkParseOptions = {}
): ParsedExtensionQuicklinkCommand | null {
  const parsed = parseRawExtensionQuicklinkCommandUrl(link)
  if (!parsed) {
    return null
  }

  const launchContext = readLaunchContext(parsed.url.searchParams.get("launchContext"))
  return {
    commandName: parsed.commandName,
    extensionName:
      resolveQuicklinkAlias(options.aliases, parsed.extensionName) ?? parsed.extensionName,
    ...(launchContext ? { launchProps: { launchContext } } : {})
  }
}

export function normalizeExtensionQuicklinkCommandUrl(
  link: string,
  options: ExtensionQuicklinkParseOptions = {}
): string {
  const parsed = parseRawExtensionQuicklinkCommandUrl(link)
  if (!parsed) {
    return link
  }

  const targetExtensionName = resolveQuicklinkAlias(options.aliases, parsed.extensionName)
  if (!targetExtensionName) {
    return link
  }

  parsed.url.pathname = `/${targetExtensionName}/${parsed.commandName}`
  return parsed.url.toString()
}

export function normalizeExtensionQuicklinkRecord(
  quicklink: ExtensionQuicklinkRecord,
  options: ExtensionQuicklinkParseOptions = {}
): ExtensionQuicklinkRecord {
  const link = normalizeExtensionQuicklinkCommandUrl(quicklink.link, options)
  const extensionName = parseExtensionQuicklinkCommandUrl(link, options)?.extensionName
  const name = normalizeExtensionQuicklinkName(quicklink.name, options.aliases)
  if (
    link === quicklink.link &&
    name === quicklink.name &&
    (!extensionName || extensionName === quicklink.extensionName)
  ) {
    return quicklink
  }

  return {
    ...quicklink,
    ...(extensionName ? { extensionName } : {}),
    link,
    name
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

function resolveQuicklinkAlias(
  aliases: readonly ExtensionQuicklinkAlias[] | undefined,
  extensionName: string
): string | null {
  return aliases?.find((alias) => alias.fromExtensionName === extensionName)?.toExtensionName ?? null
}

function normalizeExtensionQuicklinkName(
  name: string,
  aliases: readonly ExtensionQuicklinkAlias[] | undefined
): string {
  return (aliases ?? []).reduce((currentName, alias) => {
    return (alias.nameReplacements ?? []).reduce(
      (nextName, replacement) => nextName.replaceAll(replacement.from, replacement.to),
      currentName
    )
  }, name)
}

export function createExtensionQuicklinkAction(
  quicklink: ExtensionQuicklinkRecord,
  options: ExtensionQuicklinkParseOptions = {}
): LauncherSearchAction {
  const command = parseExtensionQuicklinkCommandUrl(quicklink.link, options)
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
