import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { getThread } from "../db/threads"
import {
  getPinnedAiSessionWindowRestoreState,
  setPinnedAiSessionWindowRestoreState
} from "../preferences"
import { AiSessionWindowsController } from "./controller"
import { AiSessionWindowsService, type AiSessionWindowsRuntime } from "./service"

const AI_SESSION_WINDOWS_RUNTIME_TOKEN = Symbol("AiSessionWindowsRuntime")

type AiSessionWindowsModuleRuntime = Pick<AiSessionWindowsRuntime, "createPinnedAiSessionWindow">

export function registerAiSessionWindowsModule(
  container: DependencyContainer,
  runtime: AiSessionWindowsModuleRuntime
): void {
  container.registerInstance<AiSessionWindowsModuleRuntime>(
    AI_SESSION_WINDOWS_RUNTIME_TOKEN,
    runtime
  )
  container.register(AiSessionWindowsService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      const runtime = dependencyContainer.resolve<AiSessionWindowsModuleRuntime>(
        AI_SESSION_WINDOWS_RUNTIME_TOKEN
      )
      return new AiSessionWindowsService({
        canRestorePinnedAiSessionWindow: async (threadId) => {
          const thread = await getThread(threadId)
          return thread?.archived_at === null
        },
        createPinnedAiSessionWindow: runtime.createPinnedAiSessionWindow,
        getPinnedAiSessionWindowRestoreState,
        setPinnedAiSessionWindowRestoreState
      })
    })
  })
  container.register(AiSessionWindowsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AiSessionWindowsController(dependencyContainer.resolve(AiSessionWindowsService))
    })
  })
}

export function registerAiSessionWindowsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(AiSessionWindowsController).register(ipcMain)
}
