import type {
  ExtensionAiAuthStatus,
  ExtensionAiCapability,
  ExtensionAiCapabilityTool,
  ExtensionAiCapabilityCatalogItem,
  LegacySourceProfileSnapshot,
  RunExtensionAiCapabilitySnapshot,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { ComposerMessageRef } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import { supportsNativeExtensionPlatformList } from "@shared/native-extensions"
import type { NativeExtensionPackageManifest } from "@shared/native-extensions"
import { nativeExtensionManifests } from "./index"

type ResolveNativeExtensionAiCapabilityInput = {
  getPreferences?: (extensionName: string) => Record<string, unknown>
  permissionMode?: PermissionModeName
  platform?: string
  preferencesByExtension?: Record<string, Record<string, unknown>>
}

type ResolvedExtensionPreferences =
  | {
      authStatus: "failed"
      preferences: Record<string, unknown>
    }
  | {
      authStatus: null
      preferences: Record<string, unknown>
    }

interface NativeExtensionAiCapabilityRegistryEntry {
  capability: ExtensionAiCapability
  manifest: NativeExtensionPackageManifest
}

const nativeExtensionAiCapabilityRegistry: NativeExtensionAiCapabilityRegistryEntry[] =
  nativeExtensionManifests.flatMap((manifest) =>
    manifest.aiCapability
      ? [
          {
            capability: manifest.aiCapability,
            manifest
          }
        ]
      : []
  )

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

const aiCapabilityRegistryByKey = new Map(
  nativeExtensionAiCapabilityRegistry.map((entry) => [
    getCapabilityKey({
      capabilityId: entry.capability.id,
      extensionName: entry.manifest.name
    }),
    entry
  ])
)

const aiCapabilityRegistryByExtensionName = new Map(
  nativeExtensionAiCapabilityRegistry.map((entry) => [entry.manifest.name, entry])
)

function isMissingRequiredPreferenceValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length === 0
  }

  return value === null || value === undefined
}

function resolveExtensionPreferences(
  extensionName: string,
  input: ResolveNativeExtensionAiCapabilityInput
): ResolvedExtensionPreferences {
  const persistedPreferences = input.preferencesByExtension?.[extensionName]
  if (persistedPreferences) {
    return {
      authStatus: null,
      preferences: persistedPreferences
    }
  }

  if (!input.getPreferences) {
    return {
      authStatus: null,
      preferences: {}
    }
  }

  try {
    return {
      authStatus: null,
      preferences: input.getPreferences(extensionName)
    }
  } catch (error) {
    console.warn(
      `[Sources] Failed to read preferences for extension AI capability "${extensionName}".`,
      error
    )
    return {
      authStatus: "failed",
      preferences: {}
    }
  }
}

function resolveAuthStatus(input: {
  capability: ExtensionAiCapability
  preferences: Record<string, unknown>
  supported: boolean
}): ExtensionAiAuthStatus {
  if (!input.supported) {
    return "missing"
  }

  const missingRequiredPreference = (input.capability.requiredPreferenceNames ?? []).some(
    (preferenceName) => isMissingRequiredPreferenceValue(input.preferences[preferenceName])
  )

  return missingRequiredPreference ? "missing" : "connected"
}

function resolvePublicConfig(input: {
  capability: ExtensionAiCapability
  preferences: Record<string, unknown>
}): Record<string, unknown> {
  const publicPreferenceNames = input.capability.publicPreferenceNames ?? []

  return Object.fromEntries(
    publicPreferenceNames.flatMap((preferenceName) =>
      Object.prototype.hasOwnProperty.call(input.preferences, preferenceName)
        ? [[preferenceName, input.preferences[preferenceName]]]
        : []
    )
  )
}

function toAgentToolName(input: { capability: ExtensionAiCapability; toolName: string }): string {
  return `ext__${input.capability.id}__${input.toolName}`
}

function toToolExposure(input: {
  capability: ExtensionAiCapability
  toolName: string
}): ExtensionAiCapabilityTool {
  const display = input.capability.toolDisplays?.[input.toolName]

  return {
    agentToolName: toAgentToolName(input),
    display: {
      description: display?.description ?? input.toolName,
      title: display?.title ?? input.toolName
    },
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
  const preferenceResolution = platformSupported
    ? resolveExtensionPreferences(entry.manifest.name, input)
    : {
        authStatus: null,
        preferences: {}
      }
  const preferences = preferenceResolution.preferences
  const authStatus =
    preferenceResolution.authStatus ??
    resolveAuthStatus({
      capability: entry.capability,
      preferences,
      supported: platformSupported
    })
  const enabled = platformSupported
  const enabledToolNames =
    enabled && authStatus === "connected" ? [...entry.capability.toolNames] : []

  return {
    authStatus,
    capability: entry.capability,
    displayName: entry.capability.title,
    enabled,
    enabledToolNames,
    extensionName: entry.manifest.name,
    iconName: entry.manifest.iconName,
    permissionMode: input.permissionMode ?? DEFAULT_PERMISSION_MODE,
    publicConfig: resolvePublicConfig({
      capability: entry.capability,
      preferences
    }),
    toolExposures: enabledToolNames.map((toolName) =>
      toToolExposure({
        capability: entry.capability,
        toolName
      })
    )
  }
}

function resolveEntryCapabilityFromSnapshot(
  entry: NativeExtensionAiCapabilityRegistryEntry,
  snapshot: RunExtensionAiCapabilitySnapshot
): ResolvedExtensionAiCapability {
  const enabledToolNames = snapshot.enabledToolNamesSnapshot.filter((toolName) =>
    entry.capability.toolNames.includes(toolName)
  )

  return {
    authStatus: snapshot.authStateSnapshot,
    capability: entry.capability,
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
  const keys = new Set(
    refs
      .filter(
        (ref): ref is Extract<ComposerMessageRef, { type: "extension-source" }> =>
          ref.type === "extension-source"
      )
      .map(getComposerRefCapabilityKey)
  )

  return Array.from(keys).flatMap((key) => {
    const entry = aiCapabilityRegistryByKey.get(key)
    if (!entry) {
      console.warn(`[Sources] Skipping unknown extension AI capability mention "${key}".`)
      return []
    }

    return [resolveEntryCapability(entry, input)]
  })
}

export function resolveNativeExtensionAiCapabilityForExtensionName(
  extensionName: string,
  input: ResolveNativeExtensionAiCapabilityInput = {}
): ResolvedExtensionAiCapability | null {
  const entry = aiCapabilityRegistryByExtensionName.get(extensionName)
  if (!entry) {
    console.warn(`[Sources] Skipping unknown extension AI capability "${extensionName}".`)
    return null
  }

  return resolveEntryCapability(entry, input)
}

export function listNativeExtensionAiCapabilityCatalog(
  platform?: string
): ExtensionAiCapabilityCatalogItem[] {
  return nativeExtensionAiCapabilityRegistry.flatMap((entry) => {
    const supportedPlatforms = getCapabilitySupportedPlatforms(entry.manifest, entry.capability)
    if (
      platform &&
      !supportsNativeExtensionPlatformList(supportedPlatforms, platform)
    ) {
      return []
    }

    return [
      {
        description: entry.capability.description ?? entry.manifest.description ?? entry.capability.title,
        extensionName: entry.manifest.name,
        mention: entry.capability.mention
          ? {
              label: entry.capability.mention.label ?? entry.capability.title,
              value: entry.capability.mention.value ?? entry.manifest.name
            }
          : undefined,
        sourceId: entry.capability.id,
        supportedPlatforms: supportedPlatforms ? [...supportedPlatforms] : undefined,
        title: entry.capability.title
      }
    ]
  })
}

export function hydrateNativeExtensionAiCapabilities(
  snapshots: RunExtensionAiCapabilitySnapshot[]
): ResolvedExtensionAiCapability[] {
  return snapshots.flatMap((snapshot) => {
    const entry = aiCapabilityRegistryByKey.get(
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

    return [resolveEntryCapabilityFromSnapshot(entry, snapshot)]
  })
}

export function createNativeExtensionAiCapabilitiesFromLegacySourceProfiles(
  sourceProfiles: LegacySourceProfileSnapshot[]
): ResolvedExtensionAiCapability[] {
  return sourceProfiles.flatMap((profile) => {
    const entry = aiCapabilityRegistryByKey.get(
      getCapabilityKey({
        capabilityId: profile.sourceId,
        extensionName: profile.extensionName
      })
    )
    if (!entry) {
      console.warn(
        `[Sources] Skipping legacy source profile "${profile.id}" because "${profile.extensionName}:${profile.sourceId}" is no longer registered.`
      )
      return []
    }

    const enabledToolNames = profile.enabledToolNames.filter((toolName) =>
      entry.capability.toolNames.includes(toolName)
    )
    const toolExposuresByName = new Map(profile.enabledTools.map((tool) => [tool.toolName, tool]))

    return [
      {
        authStatus: profile.authStatus,
        capability: entry.capability,
        displayName: profile.displayName,
        enabled: profile.enabled,
        enabledToolNames,
        extensionName: entry.manifest.name,
        iconName: entry.manifest.iconName,
        permissionMode: profile.defaultPermissionMode,
        publicConfig: structuredClone(profile.publicConfig),
        toolExposures:
          profile.authStatus === "connected" && profile.enabled
            ? enabledToolNames.flatMap((toolName) => {
                const existingExposure = toolExposuresByName.get(toolName)
                return existingExposure
                  ? [existingExposure]
                  : [
                      toToolExposure({
                        capability: entry.capability,
                        toolName
                      })
                    ]
              })
            : []
      }
    ]
  })
}
