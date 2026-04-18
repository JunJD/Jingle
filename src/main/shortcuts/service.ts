import { BrowserWindow } from "electron"
import { resolveShortcutPlatform } from "../../shared/shortcuts/model"
import {
  resolveShortcutBindings,
  type GlobalShortcutAvailability,
  type ResolvedShortcutBinding,
  type ShortcutSettings
} from "../../shared/shortcuts/settings"
import { getShortcutSettings, setShortcutSettings } from "../preferences"
import { getGlobalShortcutAvailability } from "../services/shortcuts/global-shortcut-service"

export class ShortcutsService {
  getBootstrapSettings(): ShortcutSettings {
    return getShortcutSettings()
  }

  getSettings(): ShortcutSettings {
    return getShortcutSettings()
  }

  setSettings(
    updates: Partial<ShortcutSettings>,
    params: { applySettings: () => void }
  ): ShortcutSettings {
    const settings = setShortcutSettings(updates)
    params.applySettings()
    this.emitSettingsChanged(settings)
    return settings
  }

  getResolvedBindings(): ResolvedShortcutBinding[] {
    return resolveShortcutBindings(getShortcutSettings(), resolveShortcutPlatform(process.platform))
  }

  getGlobalAvailability(): GlobalShortcutAvailability[] {
    return getGlobalShortcutAvailability()
  }

  private emitSettingsChanged(settings: ShortcutSettings): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("shortcuts:settingsChanged", settings)
      }
    }
  }
}
