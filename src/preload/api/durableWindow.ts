import type {
  DurableWindowThreadChangedEvent,
  OpenPrimaryMainWindowParams,
  PinThreadWindowParams,
  PinThreadWindowResult,
  SetDurableWindowThreadParams
} from "@shared/durable-window"
import { ipcRenderer, invokeIpc } from "../ipc"

export const durableWindowApi = {
  openPrimary: (params?: OpenPrimaryMainWindowParams): Promise<void> =>
    invokeIpc("durable-window:openPrimary", params),
  pinNew: (params?: PinThreadWindowParams): Promise<PinThreadWindowResult> =>
    invokeIpc("durable-window:pinNew", params),
  setThread: (params: SetDurableWindowThreadParams): Promise<void> =>
    invokeIpc("durable-window:setThread", params),
  onThreadChanged: (
    listener: (event: DurableWindowThreadChangedEvent) => void
  ): (() => void) => {
    const handler = (_event: unknown, value: DurableWindowThreadChangedEvent): void =>
      listener(value)
    ipcRenderer.on("durable-window:threadChanged", handler)
    return () => ipcRenderer.removeListener("durable-window:threadChanged", handler)
  }
}
