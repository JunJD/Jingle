import type {
  ExtensionAiCapability,
  ExtensionAiCapabilityTool,
  ExtensionToolDefinition,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import { assertExtensionAgentToolName } from "@shared/extension-sources"
import { resolveLocalizedText } from "@shared/i18n"
import {
  extensionToolCallPresentationSchema,
  extensionToolCallUiSchema,
  type ExtensionToolCallPresentation
} from "@shared/tool-presentation"

export interface RegisteredExtensionToolDefinition<
  TInput = unknown,
  TOutput = unknown
> extends ExtensionToolDefinition<TInput, TOutput> {
  extensionName: string
}

export interface ExtensionAgentToolBinding<TInput = unknown, TOutput = unknown> {
  agentToolName: string
  capability: ExtensionAiCapability
  definition: RegisteredExtensionToolDefinition<TInput, TOutput>
  display: ExtensionAiCapabilityTool["display"]
  presentation: ExtensionToolCallPresentation
  resolvedCapability: ResolvedExtensionAiCapability
}

export class ExtensionToolRegistry {
  private readonly knownExtensionNames: Set<string> | null
  private readonly toolsByExtension = new Map<
    string,
    Map<string, RegisteredExtensionToolDefinition>
  >()

  constructor(options: { knownExtensionNames?: Iterable<string> } = {}) {
    this.knownExtensionNames = options.knownExtensionNames
      ? new Set(options.knownExtensionNames)
      : null
  }

  registerExtensionTools(extensionName: string, tools: ExtensionToolDefinition[]): void {
    if (this.knownExtensionNames && !this.knownExtensionNames.has(extensionName)) {
      throw new Error(`Cannot register tools for unknown extension "${extensionName}".`)
    }

    let extensionTools = this.toolsByExtension.get(extensionName)
    if (!extensionTools) {
      extensionTools = new Map()
      this.toolsByExtension.set(extensionName, extensionTools)
    }

    for (const toolDefinition of tools) {
      if (extensionTools.has(toolDefinition.name)) {
        throw new Error(
          `Extension "${extensionName}" declares duplicate tool "${toolDefinition.name}".`
        )
      }

      extensionTools.set(toolDefinition.name, {
        ...toolDefinition,
        extensionName
      })
    }
  }

  getExtensionTool(input: {
    extensionName: string
    toolName: string
  }): RegisteredExtensionToolDefinition | null {
    return this.toolsByExtension.get(input.extensionName)?.get(input.toolName) ?? null
  }

  createAiCapabilityToolBindings(
    aiCapabilities: ResolvedExtensionAiCapability[]
  ): ExtensionAgentToolBinding[] {
    const agentToolNames = new Set<string>()
    const toolBindings: ExtensionAgentToolBinding[] = []

    for (const resolvedCapability of aiCapabilities) {
      const { capability } = resolvedCapability
      if (!resolvedCapability.enabled || resolvedCapability.authStatus !== "connected") {
        continue
      }

      const declaredToolNames = new Set(capability.toolNames)

      for (const toolExposure of resolvedCapability.toolExposures) {
        const { agentToolName, toolName } = toolExposure
        if (!declaredToolNames.has(toolName)) {
          console.warn(
            `[ExtensionTools] Skipping stale AI capability tool "${resolvedCapability.extensionName}:${capability.id}:${toolName}".`
          )
          continue
        }

        const definition = this.getExtensionTool({
          extensionName: resolvedCapability.extensionName,
          toolName
        })

        if (!definition) {
          console.warn(
            `[ExtensionTools] Skipping unavailable extension tool "${resolvedCapability.extensionName}:${toolName}" for AI capability "${capability.id}".`
          )
          continue
        }

        assertExtensionAgentToolName(agentToolName)

        if (agentToolNames.has(agentToolName)) {
          throw new Error(`Extension agent tool "${agentToolName}" is not unique.`)
        }

        const presentation = extensionToolCallPresentationSchema.parse({
          access: definition.access,
          capabilityDisplayName: resolvedCapability.displayName,
          capabilityTitle:
            resolvedCapability.capabilityTitle ??
            resolveLocalizedText(capability.title, "en-US", resolvedCapability.displayName),
          kind: "extension"
        })
        extensionToolCallUiSchema.parse({
          display: toolExposure.display,
          presentation
        })

        agentToolNames.add(agentToolName)
        toolBindings.push({
          agentToolName,
          definition,
          display: toolExposure.display,
          presentation,
          resolvedCapability,
          capability
        })
      }
    }

    return toolBindings
  }
}
