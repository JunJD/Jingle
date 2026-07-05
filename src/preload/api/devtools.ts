import type { DevtoolsNetworkEntry } from "@jingle/devtools-network"
import {
  IPC_NETWORK_CLEAR_CHANNEL,
  IPC_NETWORK_LIST_CHANNEL,
  IPC_NETWORK_OPEN_WINDOW_CHANNEL
} from "@jingle/devtools-network"
import { invokeIpc } from "../ipc"

export const devtoolsApi = {
  ipcNetwork: {
    clear(): Promise<void> {
      return invokeIpc(IPC_NETWORK_CLEAR_CHANNEL)
    },
    list(): Promise<DevtoolsNetworkEntry[]> {
      return invokeIpc(IPC_NETWORK_LIST_CHANNEL)
    },
    openWindow(): Promise<void> {
      return invokeIpc(IPC_NETWORK_OPEN_WINDOW_CHANNEL)
    }
  }
}
