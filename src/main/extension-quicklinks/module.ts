import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ExtensionQuicklinkRepository } from "./repository"
import { ExtensionQuicklinkService } from "./service"

export function registerExtensionQuicklinkModule(container: DependencyContainer): void {
  container.register(ExtensionQuicklinkRepository, {
    useFactory: instanceCachingFactory(() => new ExtensionQuicklinkRepository())
  })
  container.register(ExtensionQuicklinkService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionQuicklinkService(
        dependencyContainer.resolve(ExtensionQuicklinkRepository)
      )
    })
  })
}

export function resolveExtensionQuicklinkService(
  container: DependencyContainer
): ExtensionQuicklinkService {
  return container.resolve(ExtensionQuicklinkService)
}
