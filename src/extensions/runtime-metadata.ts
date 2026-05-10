import type { LauncherCommandSearchDefinition } from "@shared/launcher"
import * as TranslateQuickCopyMeta from "./translate/src/translate-quick-copy.meta"
import * as TranslateMeta from "./translate/src/translate.meta"
import { translateManifest } from "./translate/manifest"

interface NativeExtensionRuntimeCommandMetadata {
  name: string
  search?: LauncherCommandSearchDefinition
}

interface NativeExtensionRuntimeMetadata {
  commands: NativeExtensionRuntimeCommandMetadata[]
}

export const nativeExtensionRuntimeMetadata = new Map<string, NativeExtensionRuntimeMetadata>([
  [
    translateManifest.name,
    {
      commands: [
        {
          name: "translate",
          search: TranslateMeta.search
        },
        {
          name: "translate-quick-copy",
          search: TranslateQuickCopyMeta.search
        }
      ]
    }
  ]
])
