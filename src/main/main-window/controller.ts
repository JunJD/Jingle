import { BrowserWindow, type IpcMain } from "electron"
import { MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL } from "@shared/durable-window"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { PrimaryMainWindowService } from "./service"
import { ThreadWindowService } from "../thread-window/service"
import { getWindowIdentity, isDurableWindowIdentity } from "../windows/window-identity"
import {
  getMainWindowThreadBindingArgsSchema,
  openPrimaryMainWindowArgsSchema,
  pinThreadWindowArgsSchema,
  setDurableWindowThreadArgsSchema
} from "./controller-schema"

export class DurableWindowController {
  constructor(
    private readonly primaryMain: PrimaryMainWindowService,
    private readonly threadWindows: ThreadWindowService
  ) {}
  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL,
      getMainWindowThreadBindingArgsSchema,
      (event) => {
        const identity = getWindowIdentity(event.sender)
        if (
          event.senderFrame !== event.sender.mainFrame ||
          identity?.kind !== "main" ||
          !this.primaryMain.isSender(event.sender)
        ) {
          throw new Error("Only the registered Main window can read its thread binding.")
        }
        return this.primaryMain.getSenderThreadBinding(event.sender)
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "durable-window:openPrimary",
      openPrimaryMainWindowArgsSchema,
      (event, ...args) => {
        const params = args[0]
        const identity = getWindowIdentity(event.sender)
        if (
          event.senderFrame !== event.sender.mainFrame ||
          (identity?.kind !== "launcher" && !isDurableWindowIdentity(identity))
        ) {
          throw new Error("Only the Launcher or a durable window can open Primary Main.")
        }
        this.primaryMain.open(params)
        if (identity.kind === "launcher") {
          ;(BrowserWindow as typeof BrowserWindow | undefined)
            ?.fromWebContents(event.sender)
            ?.hide()
        }
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "durable-window:pinNew",
      pinThreadWindowArgsSchema,
      (event, ...args) => {
        const params = args[0]
        if (
          event.senderFrame !== event.sender.mainFrame ||
          !isDurableWindowIdentity(getWindowIdentity(event.sender))
        ) {
          throw new Error("Only a durable window can pin a new thread window.")
        }
        return this.threadWindows.openNew(params)
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "durable-window:setThread",
      setDurableWindowThreadArgsSchema,
      (event, params) => {
        if (event.senderFrame !== event.sender.mainFrame) {
          throw new Error("Durable window binding requires the sender main frame.")
        }
        const identity = getWindowIdentity(event.sender)
        if (identity?.kind === "main" && this.primaryMain.isSender(event.sender)) {
          return this.primaryMain.bindSenderThread(event.sender, params.threadId)
        }
        if (identity?.kind === "thread-window" && this.threadWindows.isSender(event.sender)) {
          this.threadWindows.bindSenderThread(event.sender, params.threadId)
          return null
        }
        throw new Error("Only a registered durable window can update its thread binding.")
      }
    )
  }
}
