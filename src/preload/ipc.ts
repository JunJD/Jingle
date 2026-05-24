import { ipcRenderer } from "electron"
import { normalizeInvokeError } from "./ipc-errors"

export { ipcRenderer }

export async function invokeIpc<TResult>(channel: string, ...args: unknown[]): Promise<TResult> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as TResult
  } catch (error) {
    throw normalizeInvokeError(error)
  }
}
