import type {
  ExtensionSourceBinding,
  ExtensionSourceDefinition,
  ExtensionSourceProfileTool,
  ExtensionToolDefinition,
  SourceProfile
} from "@shared/extension-sources"
import { assertExtensionAgentToolName } from "@shared/extension-sources"
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
  definition: RegisteredExtensionToolDefinition<TInput, TOutput>
  display: ExtensionSourceProfileTool["display"]
  presentation: ExtensionToolCallPresentation
  profile: SourceProfile
  source: ExtensionSourceDefinition
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

  createSourceToolBindings(sourceBindings: ExtensionSourceBinding[]): ExtensionAgentToolBinding[] {
    const agentToolNames = new Set<string>()
    const toolBindings: ExtensionAgentToolBinding[] = []

    for (const sourceBinding of sourceBindings) {
      const { profile, source } = sourceBinding
      if (!profile.enabled || profile.authStatus !== "connected") {
        continue
      }

      if (profile.sourceId !== source.id || profile.extensionName !== source.extensionName) {
        throw new Error(
          `Source profile "${profile.id}" does not match source definition "${source.id}".`
        )
      }

      const declaredSourceToolNames = new Set([
        ...source.defaultToolNames,
        ...(source.writeToolNames ?? [])
      ])

      for (const toolExposure of profile.enabledTools) {
        const { agentToolName, toolName } = toolExposure
        if (!declaredSourceToolNames.has(toolName)) {
          console.warn(
            `[ExtensionTools] Skipping stale source tool "${source.id}:${toolName}" for profile "${profile.id}".`
          )
          continue
        }

        const definition = this.getExtensionTool({
          extensionName: source.extensionName,
          toolName
        })

        if (!definition) {
          console.warn(
            `[ExtensionTools] Skipping unavailable extension tool "${source.extensionName}:${toolName}" for source "${source.id}".`
          )
          continue
        }

        assertExtensionAgentToolName(agentToolName)

        if (agentToolNames.has(agentToolName)) {
          throw new Error(`Extension agent tool "${agentToolName}" is not unique.`)
        }

        const presentation = extensionToolCallPresentationSchema.parse({
          access: definition.access,
          approval: definition.approval ?? "mode-governed",
          kind: "extension",
          profileTitle: profile.displayName,
          sourceTitle: source.title
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
          profile,
          source
        })
      }
    }

    return toolBindings
  }
}
