import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ArtifactsController } from "./controller"
import { ArtifactsService } from "./service"

export function registerArtifactsModule(container: DependencyContainer): void {
  container.register(ArtifactsService, {
    useFactory: instanceCachingFactory(() => {
      return new ArtifactsService()
    })
  })
  container.register(ArtifactsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ArtifactsController(dependencyContainer.resolve(ArtifactsService))
    })
  })
}

export function registerArtifactsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ArtifactsController).register(ipcMain)
}

export function resolveArtifactsService(container: DependencyContainer): ArtifactsService {
  return container.resolve(ArtifactsService)
}
