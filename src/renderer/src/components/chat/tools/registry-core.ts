import { createJingleToolRendererRegistry } from "@jingle/agent-react"
import type {
  ToolComponentDefinition,
  ToolComponentSpecification,
  ToolProjectionInput
} from "./types"

const toolRegistry = createJingleToolRendererRegistry<ToolComponentDefinition>()

export function createToolComponentDefinition<TViewModel>(
  specification: ToolComponentSpecification<TViewModel>
): ToolComponentDefinition {
  return {
    icon: specification.icon,
    name: specification.name,
    project(input: ToolProjectionInput) {
      const viewModel = specification.project(input)

      return {
        hasDetail(context) {
          return specification.renderDetail
            ? specification.hasDetail({ ...context, viewModel })
            : false
        },
        renderDetail(context) {
          return specification.renderDetail
            ? specification.renderDetail({ ...context, viewModel })
            : null
        },
        renderDisplay(context) {
          return specification.renderDisplay({ ...context, viewModel })
        }
      }
    }
  }
}

export function defineToolComponent<TViewModel>(
  specification: ToolComponentSpecification<TViewModel>
): ToolComponentDefinition {
  return toolRegistry.define(createToolComponentDefinition(specification))
}

export function getToolComponent(name: string): ToolComponentDefinition | undefined {
  return toolRegistry.get(name)
}

export function registerToolComponent<TViewModel>(
  specification: ToolComponentSpecification<TViewModel>
): () => void {
  return toolRegistry.register(createToolComponentDefinition(specification))
}
