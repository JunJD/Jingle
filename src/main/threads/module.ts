import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { AgentThreadRunner } from "../agent/agent-thread-runner"
import { ThreadLifecycleGate } from "../agent/thread-lifecycle-gate"
import { ArtifactsService } from "../artifacts/service"
import { ModelProviderService } from "../model-provider/service"
import { SettingsService } from "../settings/service"
import { ThreadWorkspaceService } from "../thread-workspace/service"
import { ThreadWorkflowService } from "../thread-workflow/service"
import { ThreadDigestService } from "../thread-digest/service"
import { WorkspaceService } from "../workspace/service"
import { AgentThreadDataSnapshotService } from "./agent-thread-data-snapshot-service"
import { ThreadsController } from "./controller"
import { ThreadsService } from "./service"
import { getWindowIdentity } from "../windows/window-identity"

export function registerThreadsModule(container: DependencyContainer): void {
  container.register(ThreadsService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadsService(
        dependencyContainer.resolve(ArtifactsService),
        dependencyContainer.resolve(ModelProviderService),
        dependencyContainer.resolve(SettingsService),
        dependencyContainer.resolve(WorkspaceService),
        dependencyContainer.resolve(ThreadWorkspaceService),
        dependencyContainer.resolve(ThreadDigestService),
        dependencyContainer.resolve(ThreadLifecycleGate),
        dependencyContainer.resolve(ThreadWorkflowService)
      )
    })
  })
  container.register(AgentThreadDataSnapshotService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentThreadDataSnapshotService(
        dependencyContainer.resolve(ThreadsService),
        dependencyContainer.resolve(AgentThreadRunner)
      )
    })
  })
  container.register(ThreadsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadsController(
        dependencyContainer.resolve(ThreadsService),
        dependencyContainer.resolve(AgentThreadDataSnapshotService),
        {
          getMainThreadId: (sender) => {
            const identity = getWindowIdentity(sender)
            return identity?.kind === "main" || identity?.kind === "thread-window"
              ? identity.threadId
              : null
          },
          isLauncher: (sender) => getWindowIdentity(sender)?.kind === "launcher"
        }
      )
    })
  })
}

export function registerThreadsIpcHandlers(container: DependencyContainer, ipcMain: IpcMain): void {
  container.resolve(ThreadsController).register(ipcMain)
}
