import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { AiSessionWindowsController } from "./controller"
import { AiSessionWindowsService, type AiSessionWindowsRuntime } from "./service"

const AI_SESSION_WINDOWS_RUNTIME_TOKEN = Symbol("AiSessionWindowsRuntime")

export function registerAiSessionWindowsModule(
  container: DependencyContainer,
  runtime: AiSessionWindowsRuntime
): void {
  container.registerInstance<AiSessionWindowsRuntime>(AI_SESSION_WINDOWS_RUNTIME_TOKEN, runtime)
  container.register(AiSessionWindowsService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AiSessionWindowsService(
        dependencyContainer.resolve(AI_SESSION_WINDOWS_RUNTIME_TOKEN)
      )
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
