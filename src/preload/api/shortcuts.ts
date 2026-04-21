import { ipcRenderer } from "electron"
import { resolveShortcutPlatform } from "../../shared/shortcuts/model"
import {
  resolveShortcutBindings,
  type GlobalShortcutAvailability,
  type ResolvedShortcutBinding,
  type ShortcutSettings
} from "../../shared/shortcuts/settings"
import { invokeIpc } from "../ipc"

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
    return invokeIpc("shortcuts:getSettings")
  },
  setSettings: (updates: Partial<ShortcutSettings>): Promise<ShortcutSettings> => {
    return invokeIpc("shortcuts:setSettings", updates)
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
    return invokeIpc("shortcuts:getResolvedBindings")
  },
  getGlobalAvailability: (): Promise<GlobalShortcutAvailability[]> => {
    return invokeIpc("shortcuts:getGlobalAvailability")
  }
}
