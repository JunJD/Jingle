import type {
  ExtensionSourceBinding,
  ExtensionSourceDefinition,
  SourceProfile
} from "@shared/extension-sources"
import type { ComposerMessageRef } from "@shared/message-content"
import {
  appleRemindersSourceDefinition,
  createDefaultAppleRemindersSourceBinding
} from "./apple-reminders/main/source"

type CreateDefaultSourceBindingInput = {
  now?: string
  platform?: NodeJS.Platform | string
}

interface NativeExtensionSourceRegistryEntry {
  createDefaultBinding: (input?: CreateDefaultSourceBindingInput) => ExtensionSourceBinding
  definition: ExtensionSourceDefinition
}

const nativeExtensionSourceRegistry: NativeExtensionSourceRegistryEntry[] = [
  {
    createDefaultBinding: createDefaultAppleRemindersSourceBinding,
    definition: appleRemindersSourceDefinition
  }
]

function getSourceKey(input: { extensionName: string; sourceId: string }): string {
  return `${input.extensionName}:${input.sourceId}`
}

export const nativeExtensionSourceDefinitions = nativeExtensionSourceRegistry.map(
  (entry) => entry.definition
)
const sourceRegistryByKey = new Map(
  nativeExtensionSourceRegistry.map((entry) => [
    getSourceKey({
      extensionName: entry.definition.extensionName,
      sourceId: entry.definition.id
    }),
    entry
  ])
)

export function createDefaultNativeExtensionSourceBindings(
  input: CreateDefaultSourceBindingInput = {}
): ExtensionSourceBinding[] {
  return nativeExtensionSourceRegistry.map((entry) => entry.createDefaultBinding(input))
}

export function createNativeExtensionSourceBindingsForRefs(
  refs: ComposerMessageRef[],
  input: CreateDefaultSourceBindingInput = {}
): ExtensionSourceBinding[] {
  const keys = new Set(
    refs
      .filter((ref): ref is Extract<ComposerMessageRef, { type: "extension-source" }> =>
        ref.type === "extension-source"
      )
      .map(getSourceKey)
  )

  return Array.from(keys).flatMap((key) => {
    const entry = sourceRegistryByKey.get(key)
    if (entry) {
      return [entry.createDefaultBinding(input)]
    }

    console.warn(`[Sources] Skipping unknown extension source mention "${key}".`)
    return []
  })
}

export function hydrateNativeExtensionSourceBindings(
  sourceProfiles: SourceProfile[]
): ExtensionSourceBinding[] {
  return sourceProfiles.flatMap((profile) => {
    const entry = sourceRegistryByKey.get(getSourceKey(profile))
    if (!entry) {
      console.warn(
        `[Sources] Skipping stored source profile "${profile.id}" because "${profile.extensionName}:${profile.sourceId}" is no longer registered.`
      )
      return []
    }

    return [
      {
        profile,
        source: entry.definition
      }
    ]
  })
}
