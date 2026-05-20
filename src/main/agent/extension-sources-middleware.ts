import { AIMessage } from "@langchain/core/messages"
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import type { ExtensionSourceBinding, PermissionModeName } from "@shared/extension-sources"
import { extensionToolCallUiSchema } from "@shared/tool-presentation"
import { ExtensionToolExecutor } from "../extension-tools/executor"
import type { ExtensionAgentToolBinding } from "../extension-tools/registry"
import { getRunIdFromToolRuntime } from "./run-config"

export interface CreateExtensionSourcesMiddlewareOptions {
  permissionMode?: PermissionModeName
  runId?: string | null
  sourceBindings: ExtensionSourceBinding[]
  sourceToolBindings: ExtensionAgentToolBinding[]
  threadId: string
  workspacePath: string
}

function buildToolDescription(input: {
  access: string
  description: string
  profileTitle: string
  sourceTitle: string
}): string {
  return `${input.description}\n\nSource: ${input.sourceTitle}. Profile: ${input.profileTitle}. Access: ${input.access}.`
}

export function buildExtensionSourceGuide(
  sourceBindings: ExtensionSourceBinding[],
  permissionMode?: PermissionModeName,
  sourceToolBindings?: ExtensionAgentToolBinding[]
): string {
  const sections = sourceBindings
    .filter((binding) => binding.profile.enabled)
    .map((binding) => {
      const callableToolNames = sourceToolBindings
        ? sourceToolBindings
            .filter(
              (toolBinding) =>
                toolBinding.profile.id === binding.profile.id &&
                toolBinding.source.id === binding.source.id &&
                toolBinding.source.extensionName === binding.source.extensionName
            )
            .map((toolBinding) => toolBinding.display.title)
        : binding.profile.enabledTools.map((toolExposure) => toolExposure.display.title)
      const callableStatus =
        binding.profile.authStatus === "connected" && callableToolNames.length > 0
          ? `Callable tools: ${callableToolNames.join(", ")}`
          : binding.profile.authStatus === "connected"
            ? "Callable tools: none"
            : `Callable tools: none; auth status is ${binding.profile.authStatus}`

      return [
        `Source: ${binding.source.title}`,
        `Profile: ${binding.profile.displayName}`,
        `Permission Mode: ${permissionMode ?? binding.profile.defaultPermissionMode}`,
        callableStatus,
        binding.source.guide
      ].join("\n")
    })

  if (sections.length === 0) {
    return ""
  }

  return ["### Source Guides", ...sections.map((section) => `\n${section}`)].join("\n")
}

export function createExtensionSourcesMiddleware(options: CreateExtensionSourcesMiddlewareOptions) {
  const executor = new ExtensionToolExecutor({ bindings: options.sourceToolBindings })
  const toolUiByName = new Map(
    options.sourceToolBindings.map((binding) => [
      binding.agentToolName,
      extensionToolCallUiSchema.parse({
        display: binding.display,
        presentation: binding.presentation
      })
    ])
  )
  const sourceGuide = buildExtensionSourceGuide(
    options.sourceBindings,
    options.permissionMode,
    options.sourceToolBindings
  )

  const sourceTools = options.sourceToolBindings.map((binding) =>
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
          description: binding.display.description,
          profileTitle: binding.profile.displayName,
          sourceTitle: binding.source.title
        }),
        name: binding.agentToolName,
        schema: binding.definition.inputSchema
      }
    )
  )

  return createMiddleware({
    name: "openworkExtensionSources",
    tools: sourceTools,
    wrapModelCall: async (request, handler) => {
      const nextRequest = sourceGuide
        ? {
            ...request,
            systemPrompt: `${request.systemPrompt}\n\n${sourceGuide}`
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
