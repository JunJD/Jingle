import type {
  DurableWindowThreadChangedEvent,
  MainWindowThreadBindingSnapshot,
  OpenPrimaryMainWindowParams,
  PinThreadWindowParams,
  PinThreadWindowResult,
  SetDurableWindowThreadParams,
  SetDurableWindowThreadResult
} from "@shared/durable-window"
import {
  MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL,
  MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL,
  mainWindowThreadBindingSnapshotSchema
} from "@shared/durable-window"
import { ipcRenderer, invokeIpc } from "../ipc"

function parseMainWindowThreadBindingSnapshot(value: unknown): MainWindowThreadBindingSnapshot {
  return mainWindowThreadBindingSnapshotSchema.parse(value)
}

export const durableWindowApi = {
  openPrimary: (params?: OpenPrimaryMainWindowParams): Promise<void> =>
    invokeIpc("durable-window:openPrimary", params),
  pinNew: (params?: PinThreadWindowParams): Promise<PinThreadWindowResult> =>
    invokeIpc("durable-window:pinNew", params),
  setThread: async (
    params: SetDurableWindowThreadParams
  ): Promise<SetDurableWindowThreadResult> => {
    const result = await invokeIpc<unknown>("durable-window:setThread", params)
    return result === null ? null : parseMainWindowThreadBindingSnapshot(result)
  },
  getMainThreadBinding: async (): Promise<MainWindowThreadBindingSnapshot> =>
    parseMainWindowThreadBindingSnapshot(
      await invokeIpc<unknown>(MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL)
    ),
  onMainThreadBindingChanged: (
    listener: (snapshot: MainWindowThreadBindingSnapshot) => void
  ): (() => void) => {
    const handler = (_event: unknown, value: unknown): void => {
      const parsed = mainWindowThreadBindingSnapshotSchema.safeParse(value)
      if (!parsed.success) {
        console.error("[DurableWindow] Ignored an invalid Main thread binding event.")
        return
      }
      listener(parsed.data)
    }
    ipcRenderer.on(MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL, handler)
  },
  onThreadChanged: (listener: (event: DurableWindowThreadChangedEvent) => void): (() => void) => {
    const handler = (_event: unknown, value: DurableWindowThreadChangedEvent): void =>
      listener(value)
    ipcRenderer.on("durable-window:threadChanged", handler)
    return () => ipcRenderer.removeListener("durable-window:threadChanged", handler)
  }
}
