import type { ExtensionSourceBinding, SourceProfile } from "@shared/extension-sources"
import {
  appleRemindersSourceDefinition,
  createDefaultAppleRemindersSourceBinding
} from "./apple-reminders/main/source"

export const nativeExtensionSourceDefinitions = [appleRemindersSourceDefinition]
const sourceDefinitionsByKey = new Map(
  nativeExtensionSourceDefinitions.map((definition) => [
    `${definition.extensionName}:${definition.id}`,
    definition
  ])
)

export function createDefaultNativeExtensionSourceBindings(
  input: {
    now?: string
    platform?: NodeJS.Platform | string
  } = {}
): ExtensionSourceBinding[] {
  return [createDefaultAppleRemindersSourceBinding(input)]
}

export function hydrateNativeExtensionSourceBindings(
  sourceProfiles: SourceProfile[]
): ExtensionSourceBinding[] {
  return sourceProfiles.flatMap((profile) => {
    const definition = sourceDefinitionsByKey.get(`${profile.extensionName}:${profile.sourceId}`)
    if (!definition) {
      console.warn(
        `[Sources] Skipping stored source profile "${profile.id}" because "${profile.extensionName}:${profile.sourceId}" is no longer registered.`
      )
      return []
    }

    return [
      {
        profile,
        source: definition
      }
    ]
  })
}
