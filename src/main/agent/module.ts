import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { diagnosticsLogger } from "../diagnostics/instance"
import { JingleMemoryService } from "../jingle-memory/service"
import { ThreadsService } from "../threads/service"
import { WorkspaceService } from "../workspace/service"
import { AgentThreadRunner } from "./agent-thread-runner"
import { AgentController } from "./controller"
import { AgentService } from "./service"
import { ThreadLifecycleGate } from "./thread-lifecycle-gate"
import { isLauncherWindowWebContents } from "../windows/launcher-window"
import { getPinnedAiSessionWindowThreadId } from "../windows/pinned-ai-session-window"

export function registerAgentModule(container: DependencyContainer): void {
  container.register(ThreadLifecycleGate, {
    useFactory: instanceCachingFactory(() => {
      return new ThreadLifecycleGate()
    })
  })
  container.register(AgentService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AgentService(
        dependencyContainer.resolve(JingleMemoryService),
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
        dependencyContainer.resolve(AgentThreadRunner),
        diagnosticsLogger,
        {
          getPinnedAiSessionThreadId: getPinnedAiSessionWindowThreadId,
          isLauncher: isLauncherWindowWebContents
        }
      )
    })
  })
}

export function registerAgentIpcHandlers(container: DependencyContainer, ipcMain: IpcMain): void {
  container.resolve(AgentController).register(ipcMain)
}
