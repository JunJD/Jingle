import { AIMessage } from "@langchain/core/messages"
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import type { PermissionModeName, ResolvedExtensionAiCapability } from "@shared/extension-sources"
import { extensionToolCallUiSchema } from "@shared/tool-presentation"
import { ExtensionToolExecutor } from "../extension-tools/executor"
import type { ExtensionAgentToolBinding } from "../extension-tools/registry"
import { getRunIdFromToolRuntime } from "./run-config"

export interface CreateExtensionAiMiddlewareOptions {
  aiCapabilities: ResolvedExtensionAiCapability[]
  aiToolBindings: ExtensionAgentToolBinding[]
  permissionMode?: PermissionModeName
  runId?: string | null
  threadId: string
  workspacePath: string
}

function buildToolDescription(input: {
  access: string
  capabilityTitle: string
  description: string
}): string {
  return `${input.description}\n\nExtension AI capability: ${input.capabilityTitle}. Access: ${input.access}.`
}

function buildExtensionBindingKey(capability: ResolvedExtensionAiCapability): string {
  return `${capability.extensionName}:${capability.capability.id}`
}

export function buildExtensionInstructions(
  aiCapabilities: ResolvedExtensionAiCapability[]
): string {
  const sections: string[] = []
  const seenKeys = new Set<string>()

  for (const resolvedCapability of aiCapabilities) {
    if (!resolvedCapability.enabled && resolvedCapability.authStatus === "connected") {
      continue
    }

    const instructions =
      resolvedCapability.capability.instructions?.filter((entry) => entry.trim().length > 0) ?? []
    if (instructions.length === 0) {
      continue
    }

    const key = buildExtensionBindingKey(resolvedCapability)
    if (seenKeys.has(key)) {
      continue
    }

    seenKeys.add(key)
    sections.push(
      [
        `Extension AI capability: ${resolvedCapability.capability.title}`,
        ...instructions.map((instruction) => `- ${instruction}`)
      ].join("\n")
    )
  }

  if (sections.length === 0) {
    return ""
  }

  return ["### Extension Instructions", ...sections.map((section) => `\n${section}`)].join("\n")
}

export function buildExtensionAiCapabilityGuide(
  aiCapabilities: ResolvedExtensionAiCapability[],
  permissionMode?: PermissionModeName,
  aiToolBindings?: ExtensionAgentToolBinding[]
): string {
  const sections = aiCapabilities
    .filter(
      (resolvedCapability) =>
        resolvedCapability.enabled || resolvedCapability.authStatus !== "connected"
    )
    .map((resolvedCapability) => {
      const callableToolNames = aiToolBindings
        ? aiToolBindings
            .filter(
              (toolBinding) =>
                toolBinding.resolvedCapability.extensionName ===
                  resolvedCapability.extensionName &&
                toolBinding.resolvedCapability.capability.id ===
                  resolvedCapability.capability.id
            )
            .map((toolBinding) => toolBinding.display.title)
        : resolvedCapability.toolExposures.map((toolExposure) => toolExposure.display.title)
      const callableStatus =
        resolvedCapability.authStatus === "connected" && callableToolNames.length > 0
          ? `Callable tools: ${callableToolNames.join(", ")}`
          : resolvedCapability.authStatus === "connected"
            ? "Callable tools: none"
            : `Callable tools: none; auth status is ${resolvedCapability.authStatus}`

      return [
        `Extension AI capability: ${resolvedCapability.capability.title}`,
        `Permission Mode: ${permissionMode ?? resolvedCapability.permissionMode}`,
        callableStatus,
        resolvedCapability.capability.guide
      ].join("\n")
    })

  if (sections.length === 0) {
    return ""
  }

  return [
    "### Extension AI Capability Guides",
    ...sections.map((section) => `\n${section}`)
  ].join("\n")
}

export function createExtensionAiMiddleware(options: CreateExtensionAiMiddlewareOptions) {
  const executor = new ExtensionToolExecutor({ bindings: options.aiToolBindings })
  const toolUiByName = new Map(
    options.aiToolBindings.map((binding) => [
      binding.agentToolName,
      extensionToolCallUiSchema.parse({
        display: binding.display,
        presentation: binding.presentation
      })
    ])
  )
  const aiCapabilityGuide = buildExtensionAiCapabilityGuide(
    options.aiCapabilities,
    options.permissionMode,
    options.aiToolBindings
  )
  const extensionInstructions = buildExtensionInstructions(options.aiCapabilities)
  const promptSections = [extensionInstructions, aiCapabilityGuide].filter(
    (section) => section.trim().length > 0
  )

  const aiTools = options.aiToolBindings.map((binding) =>
    tool(
      async (input, runtime: ToolRuntime) =>
        executor.executeAgentTool({
          agentToolName: binding.agentToolName,
          args: input,
          runId: getRunIdFromToolRuntime(runtime) ?? options.runId,
          threadId: options.threadId,
          workspacePath: options.workspacePath
        }),
      {
        description: buildToolDescription({
          access: binding.definition.access,
          capabilityTitle: binding.capability.title,
          description: binding.display.description
        }),
        name: binding.agentToolName,
        schema: binding.definition.inputSchema
      }
    )
  )

  return createMiddleware({
    name: "openworkExtensionAiCapabilities",
    tools: aiTools,
    wrapModelCall: async (request, handler) => {
      const nextRequest =
        promptSections.length > 0
          ? {
              ...request,
              systemPrompt: `${request.systemPrompt}\n\n${promptSections.join("\n\n")}`
            }
          : request
      const response = await handler(nextRequest)

      if (!AIMessage.isInstance(response) || !response.tool_calls?.length) {
        return response
      }

      return new AIMessage({
        additional_kwargs: response.additional_kwargs,
        content: response.content,
        id: response.id,
        invalid_tool_calls: response.invalid_tool_calls,
        name: response.name,
        response_metadata: response.response_metadata,
        tool_calls: response.tool_calls.map((toolCall) => {
          const ui = toolUiByName.get(toolCall.name)
          return ui
            ? {
                ...toolCall,
                display: ui.display,
                presentation: ui.presentation
              }
            : toolCall
        }),
        usage_metadata: response.usage_metadata
      })
    }
  })
}
