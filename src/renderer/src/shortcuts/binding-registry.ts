import { resolveShortcutPlatform } from "@shared/shortcuts/model"
import {
  resolveShortcutBindings,
  type ResolvedShortcutBinding,
  type ShortcutSettings
} from "@shared/shortcuts/settings"

export async function loadShortcutSettings(): Promise<ShortcutSettings> {
  return window.api.shortcuts.getSettings()
}

export function resolveRendererShortcutBindings(
  settings: ShortcutSettings
): ResolvedShortcutBinding[] {
  return resolveShortcutBindings(
    settings,
    resolveShortcutPlatform(window.electron.process.platform)
  )
}

export async function loadResolvedShortcutBindings(): Promise<{
  bindings: ResolvedShortcutBinding[]
  settings: ShortcutSettings
}> {
  const settings = await loadShortcutSettings()

  return {
    bindings: resolveRendererShortcutBindings(settings),
    settings
  }
}
