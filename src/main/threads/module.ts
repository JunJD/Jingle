import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { AgentThreadRunner } from "../agent/agent-thread-runner"
import { ThreadLifecycleGate } from "../agent/thread-lifecycle-gate"
import { ArtifactsService } from "../artifacts/service"
import { ModelProviderService } from "../model-provider/service"
import { SettingsService } from "../settings/service"
import { ThreadWorkspaceService } from "../thread-workspace/service"
import { WorkspaceService } from "../workspace/service"
import { ThreadsController } from "./controller"
import { ThreadsService } from "./service"

export function registerThreadsModule(container: DependencyContainer): void {
  container.register(ThreadsService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadsService(
        dependencyContainer.resolve(ArtifactsService),
        dependencyContainer.resolve(ModelProviderService),
        dependencyContainer.resolve(SettingsService),
        dependencyContainer.resolve(WorkspaceService),
        dependencyContainer.resolve(ThreadWorkspaceService),
        dependencyContainer.resolve(ThreadLifecycleGate)
      )
    })
  })
  container.register(ThreadsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadsController(
        dependencyContainer.resolve(ThreadsService),
        dependencyContainer.resolve(AgentThreadRunner)
      )
    })
  })
}

export function registerThreadsIpcHandlers(container: DependencyContainer, ipcMain: IpcMain): void {
  container.resolve(ThreadsController).register(ipcMain)
}
