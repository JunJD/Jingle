import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import {
  getMainWindowSessionState,
  getThreadWindowRestoreState,
  repairMainWindowSessionThreadBinding,
  setMainWindowSessionState,
  setThreadWindowRestoreState
} from "../preferences"
import { diagnosticsLogger } from "../diagnostics/instance"
import { serializeProcessError } from "../diagnostics/process-errors"
import { getWindowIdentity, setDurableWindowIdentityThread } from "../windows/window-identity"
import { DurableWindowController } from "./controller"
import { PrimaryMainWindowService, type PrimaryMainWindowRuntime } from "./service"
import { ThreadWindowService, type ThreadWindowRuntime } from "../thread-window/service"
import { DurableWindowLifecycleService } from "../durable-window/lifecycle"
import {
  DurableWindowRestoreGate,
  DurableWindowRestorePolicy
} from "../durable-window/restore-policy"
import { getThread } from "../db/threads"

const TOKEN = Symbol("DurableWindowRuntime")
export function registerMainWindowModule(
  container: DependencyContainer,
  runtime: Pick<PrimaryMainWindowRuntime, "createMainWindow"> &
    Pick<ThreadWindowRuntime, "createThreadWindow"> & { quitApplication: () => void }
): void {
  container.registerInstance(TOKEN, runtime)
  const restorePolicy = new DurableWindowRestorePolicy({
    getThread: async (threadId) => {
      const thread = await getThread(threadId)
      return thread ? { archivedAt: thread.archived_at } : null
    }
  })
  const restoreGate = new DurableWindowRestoreGate()
  container.register(DurableWindowLifecycleService, {
    useFactory: instanceCachingFactory(
      (c) => new DurableWindowLifecycleService(c.resolve<typeof runtime>(TOKEN).quitApplication)
    )
  })
  container.register(PrimaryMainWindowService, {
    useFactory: instanceCachingFactory((c) => {
      const owner = c.resolve<typeof runtime>(TOKEN)
      const lifecycle = c.resolve(DurableWindowLifecycleService)
      return new PrimaryMainWindowService(
        {
          ...owner,
          getSessionState: getMainWindowSessionState,
          getWindowBinding: (window) => {
            const identity = getWindowIdentity(window.webContents)
            return identity?.kind === "main"
              ? { kind: "main", threadId: identity.threadId }
              : { kind: "replaced" }
          },
          onWindowClosed: () => lifecycle.windowClosed(),
          onWindowOpened: () => lifecycle.windowOpened(),
          recordRestoreFailure: (error) =>
            diagnosticsLogger.error("Main window restore failed", {
              error: serializeProcessError(error)
            }),
          recordRestoreRepair: (details) =>
            diagnosticsLogger.warn("Stale durable window restore bindings repaired", details),
          repairSessionThreadBinding: repairMainWindowSessionThreadBinding,
          setSessionState: setMainWindowSessionState,
          setWindowThread: (window, threadId) =>
            setDurableWindowIdentityThread(window.webContents, threadId)
        },
        restorePolicy,
        restoreGate
      )
    })
  })
  container.register(ThreadWindowService, {
    useFactory: instanceCachingFactory((c) => {
      const owner = c.resolve<typeof runtime>(TOKEN)
      const lifecycle = c.resolve(DurableWindowLifecycleService)
      return new ThreadWindowService(
        {
          createThreadWindow: owner.createThreadWindow,
          getRestoreState: getThreadWindowRestoreState,
          getWindowBinding: (window) => {
            const identity = getWindowIdentity(window.webContents)
            return identity?.kind === "thread-window"
              ? {
                  kind: "thread-window",
                  threadId: identity.threadId,
                  windowId: identity.windowId
                }
              : { kind: "replaced" }
          },
          onWindowClosed: () => lifecycle.windowClosed(),
          onWindowOpened: () => lifecycle.windowOpened(),
          recordResourceRefusal: (details) =>
            diagnosticsLogger.warn("Thread window resource limit reached", details),
          recordRestoreFailure: ({ error, windowId }) =>
            diagnosticsLogger.error("Thread window restore failed", {
              error: serializeProcessError(error),
              windowId
            }),
          recordRestoreRepair: (details) =>
            diagnosticsLogger.warn("Stale durable window restore bindings repaired", details),
          setRestoreState: setThreadWindowRestoreState,
          setWindowThread: (window, threadId) =>
            setDurableWindowIdentityThread(window.webContents, threadId)
        },
        restorePolicy,
        undefined,
        restoreGate
      )
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
