import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { getAgentConfig } from "../preferences"
import { createProductionComputerUseApplicationService } from "./production"
import { ComputerUseRuntime } from "./runtime"

export function registerComputerUseModule(container: DependencyContainer): void {
  container.register(ComputerUseRuntime, {
    useFactory: instanceCachingFactory(() => {
      return new ComputerUseRuntime({
        createService: createProductionComputerUseApplicationService,
        initialConfig: getAgentConfig()
      })
    })
  })
}
