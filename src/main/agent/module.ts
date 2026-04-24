import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ThreadsService } from "../threads/service"
import { AgentController } from "./controller"
import { AgentService } from "./service"
import { AgentStreamHub } from "./stream-hub"

export function registerAgentModule(container: DependencyContainer): void {
  container.register(AgentService, {
    useFactory: instanceCachingFactory(() => {
      return new AgentService()
    })
  })
  container.register(AgentStreamHub, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentStreamHub(dependencyContainer.resolve(ThreadsService))
    })
  })
  container.register(AgentController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentController(
        dependencyContainer.resolve(AgentService),
        dependencyContainer.resolve(AgentStreamHub)
      )
    })
  })
}

export function registerAgentIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(AgentController).register(ipcMain)
}
