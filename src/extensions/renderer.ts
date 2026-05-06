import {
  type NativeExtensionRendererDefinition,
  validateNativeExtensionRendererDefinition
} from "@shared/native-extensions"
import { appleRemindersManifest } from "./apple-reminders/manifest"
import { appleRemindersRenderer } from "./apple-reminders/renderer"
import { githubManifest } from "./github/manifest"
import { githubRenderer } from "./github/renderer"
import { todoListManifest } from "./todo-list/manifest"
import { todoListRenderer } from "./todo-list/renderer"
import { translateManifest } from "./translate/manifest"
import { translateRenderer } from "./translate/renderer"
import * as TranslateQuickCopyMeta from "./translate/src/translate-quick-copy.meta"

interface NativeExtensionRuntimeRendererCommandMetadata {
  metaModule?: Record<string, unknown>
  name: string
}

interface NativeExtensionRuntimeRendererMetadata {
  commands: NativeExtensionRuntimeRendererCommandMetadata[]
}

export const nativeExtensionRendererDefinitions = new Map<
  string,
  NativeExtensionRendererDefinition
>([
  [appleRemindersManifest.name, appleRemindersRenderer],
  [githubManifest.name, githubRenderer],
  [todoListManifest.name, todoListRenderer],
  [translateManifest.name, translateRenderer]
])

validateNativeExtensionRendererDefinition(appleRemindersManifest, appleRemindersRenderer)
validateNativeExtensionRendererDefinition(githubManifest, githubRenderer)
validateNativeExtensionRendererDefinition(todoListManifest, todoListRenderer)
validateNativeExtensionRendererDefinition(translateManifest, translateRenderer)

export const nativeExtensionRuntimeRendererMetadata = new Map<
  string,
  NativeExtensionRuntimeRendererMetadata
>([
  [
    translateManifest.name,
    {
      commands: [
        {
          metaModule: TranslateQuickCopyMeta,
          name: "translate-quick-copy"
        }
      ]
    }
  ]
])
