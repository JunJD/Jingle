import type {
  ExtensionAiAuthStatus,
  ExtensionAiCapability,
  ExtensionAiCapabilityTool,
  ExtensionAiCapabilityCatalogItem,
  RunExtensionAiCapabilitySnapshot,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { ComposerMessageRef } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import { supportsNativeExtensionPlatformList } from "@shared/native-extensions"
import type {
  NativeExtensionPackageManifest,
  NativeExtensionResolvedConnection
} from "@shared/native-extensions"
import { DEFAULT_APP_LOCALE, resolveLocalizedText, type AppLocale } from "@shared/i18n"
import { nativeExtensionManifests } from "./index"

type ResolveNativeExtensionAiCapabilityInput = {
  getConnection?: (extensionName: string) => NativeExtensionResolvedConnection
  locale?: AppLocale
  permissionMode?: PermissionModeName
  platform?: string
}

type ResolvedExtensionConnectionState =
  | {
      authStatus: "failed"
      publicConfig: Record<string, unknown>
    }
  | {
      authStatus: ExtensionAiAuthStatus
      publicConfig: Record<string, unknown>
    }

interface NativeExtensionAiCapabilityRegistryEntry {
  capability: ExtensionAiCapability
  manifest: NativeExtensionPackageManifest
}

const nativeExtensionAiCapabilityRegistry: NativeExtensionAiCapabilityRegistryEntry[] =
  createNativeExtensionAiCapabilityRegistry(nativeExtensionManifests)

function createNativeExtensionAiCapabilityRegistry(
  manifests: NativeExtensionPackageManifest[]
): NativeExtensionAiCapabilityRegistryEntry[] {
  return manifests.flatMap((manifest) =>
    manifest.aiCapability
      ? [
          {
            capability: manifest.aiCapability,
            manifest
          }
        ]
      : []
  )
}

function getCapabilitySupportedPlatforms(
  manifest: NativeExtensionPackageManifest,
  capability: ExtensionAiCapability
) {
  return capability.supportedPlatforms ?? manifest.supportedPlatforms
}

function getCapabilityKey(input: { capabilityId: string; extensionName: string }): string {
  return `${input.extensionName}:${input.capabilityId}`
}

function getComposerRefCapabilityKey(
  ref: Extract<ComposerMessageRef, { type: "extension-source" }>
): string {
  return getCapabilityKey({
    capabilityId: ref.sourceId,
    extensionName: ref.extensionName
  })
}

const aiCapabilityRegistryByKey = toAiCapabilityRegistryByKey(nativeExtensionAiCapabilityRegistry)

function toAiCapabilityRegistryByKey(entries: NativeExtensionAiCapabilityRegistryEntry[]) {
  return new Map(
    entries.map((entry) => [
      getCapabilityKey({
        capabilityId: entry.capability.id,
        extensionName: entry.manifest.name
      }),
      entry
    ])
  )
}

const aiCapabilityRegistryByExtensionName = toAiCapabilityRegistryByExtensionName(
  nativeExtensionAiCapabilityRegistry
)

function toAiCapabilityRegistryByExtensionName(
  entries: NativeExtensionAiCapabilityRegistryEntry[]
) {
  return new Map(entries.map((entry) => [entry.manifest.name, entry]))
}

function resolveNativeExtensionAiCapabilitiesForRefsWithRegistry(
  refs: ComposerMessageRef[],
  entriesByKey: Map<string, NativeExtensionAiCapabilityRegistryEntry>,
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability[] {
  const keys = new Set(
    refs
      .filter(
        (ref): ref is Extract<ComposerMessageRef, { type: "extension-source" }> =>
          ref.type === "extension-source"
      )
      .map(getComposerRefCapabilityKey)
  )

  return Array.from(keys).flatMap((key) => {
    const entry = entriesByKey.get(key)
    if (!entry) {
      console.warn(`[Sources] Skipping unknown extension AI capability mention "${key}".`)
      return []
    }

    return [resolveEntryCapability(entry, input)]
  })
}

function resolveNativeExtensionAiCapabilityForExtensionNameWithRegistry(
  extensionName: string,
  entriesByExtensionName: Map<string, NativeExtensionAiCapabilityRegistryEntry>,
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability | null {
  const entry = entriesByExtensionName.get(extensionName)
  if (!entry) {
    console.warn(`[Sources] Skipping unknown extension AI capability "${extensionName}".`)
    return null
  }

  return resolveEntryCapability(entry, input)
}

function hydrateNativeExtensionAiCapabilitiesWithRegistry(
  snapshots: RunExtensionAiCapabilitySnapshot[],
  entriesByKey: Map<string, NativeExtensionAiCapabilityRegistryEntry>,
  locale: AppLocale = DEFAULT_APP_LOCALE
): ResolvedExtensionAiCapability[] {
  return snapshots.flatMap((snapshot) => {
    const entry = entriesByKey.get(
      getCapabilityKey({
        capabilityId: snapshot.capabilityId,
        extensionName: snapshot.extensionName
      })
    )

    if (!entry) {
      console.warn(
        `[Sources] Skipping stored AI capability "${snapshot.extensionName}:${snapshot.capabilityId}" because it is no longer registered.`
      )
      return []
    }

    return [resolveEntryCapabilityFromSnapshot(entry, snapshot, locale)]
  })
}

function mapConnectionStatusToAuthStatus(
  status: NativeExtensionResolvedConnection["status"]
): ExtensionAiAuthStatus {
  switch (status) {
    case "connected":
      return "connected"
    case "failed":
      return "failed"
    case "missing":
    case "unsupported":
      return "missing"
  }
}

function resolveConnectionState(
  extensionName: string,
  supported: boolean,
  input: ResolveNativeExtensionAiCapabilityInput
): ResolvedExtensionConnectionState {
  if (!supported) {
    return {
      authStatus: "missing",
      publicConfig: {}
    }
  }

  if (!input.getConnection) {
    console.warn(
      `[Sources] Missing connection resolver for extension AI capability "${extensionName}".`
    )
    return {
      authStatus: "failed",
      publicConfig: {}
    }
  }

  try {
    const connection = input.getConnection(extensionName)
    return {
      authStatus: mapConnectionStatusToAuthStatus(connection.status),
      publicConfig: connection.publicConfig
    }
  } catch (error) {
    console.warn(
      `[Sources] Failed to read connection for extension AI capability "${extensionName}".`,
      error
    )
    return {
      authStatus: "failed",
      publicConfig: {}
    }
  }
}

function resolveAuthStatus(input: {
  connectionState: ResolvedExtensionConnectionState
}): ExtensionAiAuthStatus {
  if (input.connectionState.authStatus === "failed") {
    return "failed"
  }

  return input.connectionState.authStatus
}

function resolvePublicConfig(input: {
  connectionState: ResolvedExtensionConnectionState
}): Record<string, unknown> {
  return input.connectionState.publicConfig
}

function toAgentToolName(input: { capability: ExtensionAiCapability; toolName: string }): string {
  return `ext__${toAgentToolNameSegment(input.capability.id)}__${input.toolName}`
}

function toAgentToolNameSegment(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment, index) =>
      index === 0
        ? segment.charAt(0).toLowerCase() + segment.slice(1)
        : segment.charAt(0).toUpperCase() + segment.slice(1)
    )
    .join("")
}

function toToolExposure(input: {
  capability: ExtensionAiCapability
  locale: AppLocale
  toolName: string
}): ExtensionAiCapabilityTool {
  const display = input.capability.toolDisplays?.[input.toolName]
  const title = resolveLocalizedText(display?.title, input.locale, input.toolName)

  return {
    agentToolName: toAgentToolName(input),
    display: {
      description: resolveLocalizedText(display?.description, input.locale, title),
      title
    },
    toolName: input.toolName
  }
}

function toCatalogToolSummary(input: {
  capability: ExtensionAiCapability
  locale: AppLocale
  toolName: string
}) {
  const display = input.capability.toolDisplays?.[input.toolName]
  const title = resolveLocalizedText(display?.title, input.locale, input.toolName)

  return {
    description: resolveLocalizedText(display?.description, input.locale, title),
    title,
    toolName: input.toolName
  }
}

function resolveEntryCapability(
  entry: NativeExtensionAiCapabilityRegistryEntry,
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability {
  const platformSupported = input.platform
    ? supportsNativeExtensionPlatformList(
        getCapabilitySupportedPlatforms(entry.manifest, entry.capability),
        input.platform
      )
    : true
  const connectionState = resolveConnectionState(
    entry.manifest.name,
    platformSupported,
    input
  )
  const authStatus = resolveAuthStatus({ connectionState })
  const enabled = platformSupported
  const enabledToolNames =
    enabled && authStatus === "connected" ? [...entry.capability.toolNames] : []
  const locale = input.locale ?? DEFAULT_APP_LOCALE
  const permissionMode =
    entry.capability.permissionMode ?? input.permissionMode ?? DEFAULT_PERMISSION_MODE

  return {
    authStatus,
    capability: entry.capability,
    capabilityTitle: resolveLocalizedText(entry.capability.title, locale),
    displayName: resolveLocalizedText(entry.capability.title, locale),
    enabled,
    enabledToolNames,
    extensionName: entry.manifest.name,
    iconName: entry.manifest.iconName,
    permissionMode,
    publicConfig: resolvePublicConfig({
      connectionState
    }),
    toolExposures: enabledToolNames.map((toolName) =>
      toToolExposure({
        capability: entry.capability,
        locale,
        toolName
      })
    )
  }
}

function resolveEntryCapabilityFromSnapshot(
  entry: NativeExtensionAiCapabilityRegistryEntry,
  snapshot: RunExtensionAiCapabilitySnapshot,
  locale: AppLocale = DEFAULT_APP_LOCALE
): ResolvedExtensionAiCapability {
  const enabledToolNames = snapshot.enabledToolNamesSnapshot.filter((toolName) =>
    entry.capability.toolNames.includes(toolName)
  )

  return {
    authStatus: snapshot.authStateSnapshot,
    capability: entry.capability,
    capabilityTitle: resolveLocalizedText(entry.capability.title, locale),
    displayName: snapshot.displayNameSnapshot,
    enabled: snapshot.enabledSnapshot,
    enabledToolNames,
    extensionName: entry.manifest.name,
    iconName: entry.manifest.iconName,
    permissionMode: snapshot.permissionModeSnapshot,
    publicConfig: structuredClone(snapshot.publicConfigSnapshot),
    toolExposures:
      snapshot.authStateSnapshot === "connected" && snapshot.enabledSnapshot
        ? enabledToolNames.map((toolName) =>
            toToolExposure({
              capability: entry.capability,
              locale,
              toolName
            })
          )
        : []
  }
}

export function resolveNativeExtensionAiCapabilitiesForRefs(
  refs: ComposerMessageRef[],
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability[] {
  return resolveNativeExtensionAiCapabilitiesForRefsWithRegistry(
    refs,
    aiCapabilityRegistryByKey,
    input
  )
}

export function resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
  refs: ComposerMessageRef[],
  manifests: NativeExtensionPackageManifest[],
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability[] {
  const entries = createNativeExtensionAiCapabilityRegistry(manifests)
  return resolveNativeExtensionAiCapabilitiesForRefsWithRegistry(
    refs,
    toAiCapabilityRegistryByKey(entries),
    input
  )
}

export function resolveNativeExtensionAiCapabilityForExtensionName(
  extensionName: string,
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability | null {
  return resolveNativeExtensionAiCapabilityForExtensionNameWithRegistry(
    extensionName,
    aiCapabilityRegistryByExtensionName,
    input
  )
}

export function resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
  extensionName: string,
  manifests: NativeExtensionPackageManifest[],
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability | null {
  return resolveNativeExtensionAiCapabilityForExtensionNameWithRegistry(
    extensionName,
    toAiCapabilityRegistryByExtensionName(createNativeExtensionAiCapabilityRegistry(manifests)),
    input
  )
}

export function buildNativeExtensionAiCapabilityCatalogItem(input: {
  capability: ExtensionAiCapability
  locale?: AppLocale
  manifest: NativeExtensionPackageManifest
}): ExtensionAiCapabilityCatalogItem {
  const supportedPlatforms = getCapabilitySupportedPlatforms(input.manifest, input.capability)
  const locale = input.locale ?? DEFAULT_APP_LOCALE
  const title = resolveLocalizedText(input.capability.title, locale)
  const catalogItem: ExtensionAiCapabilityCatalogItem = {
    description: resolveLocalizedText(
      input.capability.description ?? input.manifest.description,
      locale,
      title
    ),
    extensionName: input.manifest.name,
    guide: input.capability.guide,
    sourceId: input.capability.id,
    supportedPlatforms: supportedPlatforms ? [...supportedPlatforms] : undefined,
    title,
    toolNames: [...input.capability.toolNames],
    tools: input.capability.toolNames.map((toolName) =>
      toCatalogToolSummary({
        capability: input.capability,
        locale,
        toolName
      })
    )
  }

  if (input.capability.mention) {
    catalogItem.mention = {
      label: resolveLocalizedText(input.capability.mention.label, locale, title),
      value: input.capability.mention.value ?? input.manifest.name
    }
  }

  return catalogItem
}

export function listNativeExtensionAiCapabilityCatalog(
  platform?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): ExtensionAiCapabilityCatalogItem[] {
  return listNativeExtensionAiCapabilityCatalogFromManifests(
    nativeExtensionManifests,
    platform,
    locale
  )
}

export function listNativeExtensionAiCapabilityCatalogFromManifests(
  manifests: NativeExtensionPackageManifest[],
  platform?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): ExtensionAiCapabilityCatalogItem[] {
  return createNativeExtensionAiCapabilityRegistry(manifests).flatMap((entry) => {
    const supportedPlatforms = getCapabilitySupportedPlatforms(entry.manifest, entry.capability)
    if (platform && !supportsNativeExtensionPlatformList(supportedPlatforms, platform)) {
      return []
    }

    return [buildNativeExtensionAiCapabilityCatalogItem({ ...entry, locale })]
  })
}

export function hydrateNativeExtensionAiCapabilities(
  snapshots: RunExtensionAiCapabilitySnapshot[],
  locale: AppLocale = DEFAULT_APP_LOCALE
): ResolvedExtensionAiCapability[] {
  return hydrateNativeExtensionAiCapabilitiesWithRegistry(
    snapshots,
    aiCapabilityRegistryByKey,
    locale
  )
}

export function hydrateNativeExtensionAiCapabilitiesFromManifests(
  snapshots: RunExtensionAiCapabilitySnapshot[],
  manifests: NativeExtensionPackageManifest[],
  locale: AppLocale = DEFAULT_APP_LOCALE
): ResolvedExtensionAiCapability[] {
  return hydrateNativeExtensionAiCapabilitiesWithRegistry(
    snapshots,
    toAiCapabilityRegistryByKey(createNativeExtensionAiCapabilityRegistry(manifests)),
    locale
  )
}
