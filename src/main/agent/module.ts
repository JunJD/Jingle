import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { AgentController } from "./controller"
import { AgentService } from "./service"

export function registerAgentModule(container: DependencyContainer): void {
  container.register(AgentService, {
    useFactory: instanceCachingFactory(() => {
      return new AgentService()
    })
  })
  container.register(AgentController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentController(dependencyContainer.resolve(AgentService))
    })
  })
}

export function registerAgentIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(AgentController).register(ipcMain)
}
