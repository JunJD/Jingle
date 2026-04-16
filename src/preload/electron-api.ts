import { ipcRenderer } from "electron"
import type { SettingsWindowNavigationPayload, SettingsWindowTab } from "../shared/settings-window"

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
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  },
  openSettings: (): Promise<void> => {
    return ipcRenderer.invoke("settings:openWindow")
  },
  openExternal: (url: string): Promise<void> => {
    return ipcRenderer.invoke("shell:openExternal", url)
  },
  openSettingsTab: (
    tab: SettingsWindowTab,
    target?: SettingsWindowNavigationPayload["target"]
  ): Promise<void> => {
    return ipcRenderer.invoke("settings:openTab", { tab, ...(target ? { target } : {}) })
  },
  onSettingsTabChanged: (
    callback: (payload: SettingsWindowNavigationPayload) => void
  ): (() => void) => {
    const listener = (_event: unknown, payload: SettingsWindowNavigationPayload): void => {
      callback(payload)
    }

    ipcRenderer.on("settings-tab-changed", listener)
    return () => {
      ipcRenderer.removeListener("settings-tab-changed", listener)
    }
  },
  process: {
    platform: process.platform,
    versions: process.versions
  }
}

export type OpenworkElectronAPI = typeof electronAPI
