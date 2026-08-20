import type {
  DurableWindowThreadBindingSnapshot,
  OpenPrimaryMainWindowParams,
  PinThreadWindowParams,
  PinThreadWindowResult,
  SetDurableWindowThreadParams,
  SetDurableWindowThreadResult
} from "@shared/durable-window"
import {
  DURABLE_WINDOW_THREAD_BINDING_CHANGED_CHANNEL,
  DURABLE_WINDOW_THREAD_BINDING_GET_CHANNEL,
  durableWindowThreadBindingSnapshotSchema
} from "@shared/durable-window"
import { ipcRenderer, invokeIpc } from "../ipc"

function parseDurableWindowThreadBindingSnapshot(
  value: unknown
): DurableWindowThreadBindingSnapshot {
  return durableWindowThreadBindingSnapshotSchema.parse(value)
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
    return parseDurableWindowThreadBindingSnapshot(result)
  },
  getThreadBinding: async (): Promise<DurableWindowThreadBindingSnapshot> =>
    parseDurableWindowThreadBindingSnapshot(
      await invokeIpc<unknown>(DURABLE_WINDOW_THREAD_BINDING_GET_CHANNEL)
    ),
  onThreadBindingChanged: (
    listener: (snapshot: DurableWindowThreadBindingSnapshot) => void
  ): (() => void) => {
    const handler = (_event: unknown, value: unknown): void => {
      const parsed = durableWindowThreadBindingSnapshotSchema.safeParse(value)
      if (!parsed.success) {
        console.error("[DurableWindow] Ignored an invalid thread binding event.")
        return
      }
      listener(parsed.data)
    }
    ipcRenderer.on(DURABLE_WINDOW_THREAD_BINDING_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DURABLE_WINDOW_THREAD_BINDING_CHANGED_CHANNEL, handler)
  }
}
