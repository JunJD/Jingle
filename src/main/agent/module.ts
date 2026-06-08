import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { OpenworkMemoryService } from "../openwork-memory/service"
import { ThreadsService } from "../threads/service"
import { WorkspaceService } from "../workspace/service"
import { AgentThreadRunner } from "./agent-thread-runner"
import { AgentController } from "./controller"
import { AgentService } from "./service"
import { ThreadLifecycleGate } from "./thread-lifecycle-gate"

export function registerAgentModule(container: DependencyContainer): void {
  container.register(ThreadLifecycleGate, {
    useFactory: instanceCachingFactory(() => {
      return new ThreadLifecycleGate()
    })
  })
  container.register(AgentService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentService(
        dependencyContainer.resolve(OpenworkMemoryService),
        dependencyContainer.resolve(ThreadLifecycleGate),
        dependencyContainer.resolve(WorkspaceService)
      )
    })
  })
  container.register(AgentThreadRunner, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentThreadRunner(dependencyContainer.resolve(ThreadsService))
    })
  })
  container.register(AgentController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentController(
        dependencyContainer.resolve(AgentService),
        dependencyContainer.resolve(AgentThreadRunner)
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
