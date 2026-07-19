import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import {
  getMainWindowSessionState,
  getThreadWindowRestoreState,
  setMainWindowSessionState,
  setThreadWindowRestoreState
} from "../preferences"
import { diagnosticsLogger } from "../diagnostics/instance"
import { serializeProcessError } from "../diagnostics/process-errors"
import { setDurableWindowIdentityThread } from "../windows/window-identity"
import { DurableWindowController } from "./controller"
import { PrimaryMainWindowService, type PrimaryMainWindowRuntime } from "./service"
import { ThreadWindowService, type ThreadWindowRuntime } from "../thread-window/service"
import { DurableWindowLifecycleService } from "../durable-window/lifecycle"
import { requestWindowPresentation } from "../windows/window-presentation"

const TOKEN = Symbol("DurableWindowRuntime")
export function registerMainWindowModule(
  container: DependencyContainer,
  runtime: Pick<PrimaryMainWindowRuntime, "createMainWindow"> &
    Pick<ThreadWindowRuntime, "createThreadWindow">
): void {
  container.registerInstance(TOKEN, runtime)
  container.register(DurableWindowLifecycleService, {
    useFactory: instanceCachingFactory(() => new DurableWindowLifecycleService())
  })
  container.register(PrimaryMainWindowService, {
    useFactory: instanceCachingFactory((c) => {
      const owner = c.resolve<typeof runtime>(TOKEN)
      const lifecycle = c.resolve(DurableWindowLifecycleService)
      return new PrimaryMainWindowService({
        ...owner,
        getSessionState: getMainWindowSessionState,
        onWindowClosed: () => lifecycle.windowClosed(),
        onWindowOpened: () => lifecycle.windowOpened(),
        presentWindow: requestWindowPresentation,
        setSessionState: setMainWindowSessionState,
        setWindowThread: (window, threadId) =>
          setDurableWindowIdentityThread(window.webContents, threadId)
      })
    })
  })
  container.register(ThreadWindowService, {
    useFactory: instanceCachingFactory((c) => {
      const owner = c.resolve<typeof runtime>(TOKEN)
      const lifecycle = c.resolve(DurableWindowLifecycleService)
      return new ThreadWindowService({
        createThreadWindow: owner.createThreadWindow,
        getRestoreState: getThreadWindowRestoreState,
        onWindowClosed: () => lifecycle.windowClosed(),
        onWindowOpened: () => lifecycle.windowOpened(),
        recordResourceRefusal: (details) =>
          diagnosticsLogger.warn("Thread window resource limit reached", details),
        recordRestoreFailure: ({ error, windowId }) =>
          diagnosticsLogger.error("Thread window restore failed", {
            error: serializeProcessError(error),
            windowId
          }),
        setRestoreState: setThreadWindowRestoreState,
        setWindowThread: (window, threadId) =>
          setDurableWindowIdentityThread(window.webContents, threadId)
      })
    })
  })
  container.register(DurableWindowController, {
    useFactory: instanceCachingFactory(
      (c) =>
        new DurableWindowController(
          c.resolve(PrimaryMainWindowService),
          c.resolve(ThreadWindowService)
        )
    )
  })
}
export function registerMainWindowIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(DurableWindowController).register(ipcMain)
}
