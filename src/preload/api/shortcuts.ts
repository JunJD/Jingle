import { ipcRenderer } from "electron"
import { resolveShortcutPlatform } from "../../shared/shortcuts/model"
import {
  resolveShortcutBindings,
  type GlobalShortcutAvailability,
  type ResolvedShortcutBinding,
  type ShortcutSettings
} from "../../shared/shortcuts/settings"

const initialShortcutSettings = ipcRenderer.sendSync(
  "shortcuts:getBootstrapSettingsSync"
) as ShortcutSettings
const initialResolvedShortcutBindings = resolveShortcutBindings(
  initialShortcutSettings,
  resolveShortcutPlatform(process.platform)
)

export const shortcutsApi = {
  initialResolvedBindings: initialResolvedShortcutBindings,
  initialSettings: initialShortcutSettings,
  getSettings: (): Promise<ShortcutSettings> => {
    return ipcRenderer.invoke("shortcuts:getSettings")
  },
  setSettings: (updates: Partial<ShortcutSettings>): Promise<ShortcutSettings> => {
    return ipcRenderer.invoke("shortcuts:setSettings", updates)
  },
  onSettingsChanged: (callback: (settings: ShortcutSettings) => void): (() => void) => {
    const handler = (_event: unknown, settings: ShortcutSettings): void => {
      callback(settings)
    }

    ipcRenderer.on("shortcuts:settingsChanged", handler)
    return () => {
      ipcRenderer.removeListener("shortcuts:settingsChanged", handler)
    }
  },
  getResolvedBindings: (): Promise<ResolvedShortcutBinding[]> => {
    return ipcRenderer.invoke("shortcuts:getResolvedBindings")
  },
  getGlobalAvailability: (): Promise<GlobalShortcutAvailability[]> => {
    return ipcRenderer.invoke("shortcuts:getGlobalAvailability")
  }
}
