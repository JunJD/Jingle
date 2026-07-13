import {
  createSettingsWindowNavigationPayload,
  type SettingsWindowTab,
  type SettingsWindowTarget
} from "@shared/settings-window"
import { invokeIpc, ipcRenderer } from "./ipc"

export const electronAPI = {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const handler = (_event: unknown, ...args: unknown[]): void => {
        listener(...args)
      }

      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    once: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.once(channel, (_event, ...args) => listener(...args))
    },
    invoke: (channel: string, ...args: unknown[]) => invokeIpc(channel, ...args)
  },
  openSettings: (): Promise<void> => {
    return invokeIpc("settings:openWindow")
  },
  openExternal: (url: string): Promise<void> => {
    return invokeIpc("shell:openExternal", url)
  },
  openSettingsTab: (tab: SettingsWindowTab, target?: SettingsWindowTarget): Promise<void> => {
    return invokeIpc("settings:openTab", createSettingsWindowNavigationPayload(tab, target))
  },
  process: {
    platform: process.platform,
    versions: process.versions
  }
}

export type JingleElectronAPI = typeof electronAPI
