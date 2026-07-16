import { BrowserWindow, type IpcMain } from "electron"
import type {
  OpenPrimaryMainWindowParams,
  PinThreadWindowParams,
  SetDurableWindowThreadParams
} from "@shared/durable-window"
import { registerIpcHandle } from "../ipc/handle"
import { PrimaryMainWindowService } from "./service"
import { ThreadWindowService } from "../thread-window/service"
import { getWindowIdentity, isDurableWindowIdentity } from "../windows/window-identity"

function parseOptionalThreadParams(value: unknown): { threadId?: string } {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Durable window parameters are invalid.")
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== "threadId")) {
    throw new Error("Durable window parameters are invalid.")
  }
  if (record.threadId === undefined) return {}
  if (typeof record.threadId !== "string" || !record.threadId.trim()) {
    throw new Error("Durable window threadId is invalid.")
  }
  return { threadId: record.threadId.trim() }
}

function parseRequiredThreadParams(value: unknown): { threadId: string } {
  const parsed = parseOptionalThreadParams(value)
  if (!parsed.threadId) throw new Error("Durable window threadId is required.")
  return { threadId: parsed.threadId }
}

export class DurableWindowController {
  constructor(
    private readonly primaryMain: PrimaryMainWindowService,
    private readonly threadWindows: ThreadWindowService
  ) {}
  register(ipcMain: IpcMain): void {
    registerIpcHandle(
      ipcMain,
      "durable-window:openPrimary",
      (event, params?: OpenPrimaryMainWindowParams) => {
      const identity = getWindowIdentity(event.sender)
      if (
        event.senderFrame !== event.sender.mainFrame ||
          (identity?.kind !== "launcher" && !isDurableWindowIdentity(identity))
      ) {
          throw new Error("Only the Launcher or a durable window can open Primary Main.")
      }
        this.primaryMain.open(parseOptionalThreadParams(params))
        if (identity.kind === "launcher") {
          ;(BrowserWindow as typeof BrowserWindow | undefined)?.fromWebContents(event.sender)?.hide()
        }
      }
    )
    registerIpcHandle(
      ipcMain,
      "durable-window:pinNew",
      (event, params?: PinThreadWindowParams) => {
        if (
          event.senderFrame !== event.sender.mainFrame ||
          !isDurableWindowIdentity(getWindowIdentity(event.sender))
        ) {
          throw new Error("Only a durable window can pin a new thread window.")
        }
        return this.threadWindows.openNew(parseOptionalThreadParams(params))
      }
    )
    registerIpcHandle(
      ipcMain,
      "durable-window:setThread",
      (event, params: SetDurableWindowThreadParams) => {
        if (event.senderFrame !== event.sender.mainFrame) {
          throw new Error("Durable window binding requires the sender main frame.")
        }
        const parsed = parseRequiredThreadParams(params)
        const identity = getWindowIdentity(event.sender)
        if (identity?.kind === "main" && this.primaryMain.isSender(event.sender)) {
          this.primaryMain.bindSenderThread(event.sender, parsed.threadId)
          return
        }
        if (identity?.kind === "thread-window" && this.threadWindows.isSender(event.sender)) {
          this.threadWindows.bindSenderThread(event.sender, parsed.threadId)
          return
        }
        throw new Error("Only a registered durable window can update its thread binding.")
      }
    )
  }
}
