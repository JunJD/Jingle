import type { IpcMain } from "electron"
import {
  IPC_NETWORK_CLEAR_CHANNEL,
  IPC_NETWORK_LIST_CHANNEL,
  IPC_NETWORK_OPEN_WINDOW_CHANNEL
} from "@jingle/devtools-network"
import { registerIpcHandle } from "./handle"
import { getDevtoolsNetworkRecorder } from "@jingle/devtools-network/main"

export interface RegisterIpcNetworkHandlersOptions {
  readonly openWindow: () => void
}

export function registerIpcNetworkHandlers(
  ipcMain: IpcMain,
  options: RegisterIpcNetworkHandlersOptions
): void {
  registerIpcHandle(ipcMain, IPC_NETWORK_LIST_CHANNEL, () => {
    return getDevtoolsNetworkRecorder().list()
  })

  registerIpcHandle(ipcMain, IPC_NETWORK_CLEAR_CHANNEL, () => {
    getDevtoolsNetworkRecorder().clear()
  })

  registerIpcHandle(ipcMain, IPC_NETWORK_OPEN_WINDOW_CHANNEL, () => {
    options.openWindow()
  })
}
