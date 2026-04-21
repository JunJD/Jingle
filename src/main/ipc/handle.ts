import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { ZodType } from "zod/v4"
import { buildSerializedIpcErrorMessage } from "./error"
import { parseIpcPayloadWithSchema } from "./schema"

export function registerIpcHandle<TArgs extends unknown[], TResult>(
  ipcMain: Pick<IpcMain, "handle">,
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as TArgs))
    } catch (error) {
      throw new Error(buildSerializedIpcErrorMessage(channel, error))
    }
  })
}

export function registerValidatedIpcHandle<TArgs extends unknown[], TResult>(
  ipcMain: Pick<IpcMain, "handle">,
  channel: string,
  schema: ZodType<TArgs>,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult
): void {
  registerIpcHandle(ipcMain, channel, (event, ...rawArgs: unknown[]) => {
    const parsedArgs = parseIpcPayloadWithSchema(channel, schema, rawArgs)
    return handler(event, ...parsedArgs)
  })
}
