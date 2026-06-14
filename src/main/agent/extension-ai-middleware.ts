import { AIMessage, ToolMessage } from "@langchain/core/messages"
import { Command } from "@langchain/langgraph"
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import type {
  ExtensionAiCapabilityCatalogItem,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { NativeExtensionExecutionContext } from "@shared/native-extensions"
import { resolveLocalizedText } from "@shared/i18n"
import { extensionToolCallUiSchema } from "@shared/tool-presentation"
import { ToolSchemaValidationError, z } from "./tool-input-schema"
import { presentExtensionToolOutputs } from "../artifacts/extension-tool-outputs"
import { ExtensionToolExecutor } from "../extension-tools/executor"
import type { ExtensionAgentToolBinding } from "../extension-tools/registry"
import { getRunIdFromToolRuntime } from "./run-config"
import type {
  ExtensionAiSession,
  LoadedExtensionAiCapabilitiesChange
} from "./extension-ai-session"

export interface CreateExtensionAiMiddlewareOptions {
  aiCapabilityCatalog: ExtensionAiCapabilityCatalogItem[]
  getAiCapabilityByExtensionName?: (extensionName: string) => ResolvedExtensionAiCapability | null
  getExtensionExecutionContext?: (extensionName: string) => NativeExtensionExecutionContext
  getExtensionPreferences?: (extensionName: string) => Record<string, unknown>
  onLoadedAiCapabilitiesChanged?: (
    change: LoadedExtensionAiCapabilitiesChange
  ) => Promise<void> | void
  runId?: string | null
  session: ExtensionAiSession
  threadId: string
  workspacePath: string
}

const CALL_EXTENSION_TOOL_NAME = "callExtension"

const callExtensionInputSchema = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
  extensionName: z.string().trim().min(1),
  toolName: z.string().trim().min(1)
})

const loadExtensionInputSchema = z.object({
  extensionName: z.string().trim().min(1)
})

function buildExtensionBindingKey(capability: ResolvedExtensionAiCapability): string {
  return `${capability.extensionName}:${capability.capability.id}`
}

function normalizeToolNameForModel(value: string): string {
  return value.trim()
}

function findBinding(input: {
  extensionName: string
  session: ExtensionAiSession
  toolName: string
}): ExtensionAgentToolBinding | null {
  const requestedToolName = normalizeToolNameForModel(input.toolName)
  return (
    input.session
      .getVisibleToolBindings()
      .find(
        (binding) =>
          binding.resolvedCapability.extensionName === input.extensionName &&
          binding.definition.name === requestedToolName
      ) ?? null
  )
}

function getToolCallIdFromRuntime(runtime: ToolRuntime): string | null {
  const legacyToolCallId = (runtime as ToolRuntime & { toolCallId?: unknown }).toolCallId
  if (typeof legacyToolCallId === "string" && legacyToolCallId.length > 0) {
    return legacyToolCallId
  }

  const toolCall = (runtime as ToolRuntime & { toolCall?: { id?: unknown } }).toolCall
  return typeof toolCall?.id === "string" && toolCall.id.length > 0 ? toolCall.id : null
}

function formatToolSchema(binding: ExtensionAgentToolBinding): string {
  const schema = binding.definition.inputSchema as { toJSONSchema?: () => unknown }
  const jsonSchema = schema.toJSONSchema?.()
  return JSON.stringify(jsonSchema ?? { type: "object" }, null, 2)
}

function buildLoadedExtensionToolListSection(bindings: ExtensionAgentToolBinding[]): string {
  if (bindings.length === 0) {
    return "Callable tools: none."
  }

  return `Callable tools: ${bindings.map((binding) => binding.definition.name).join(", ")}`
}

function buildLoadedExtensionToolDetails(binding: ExtensionAgentToolBinding): string {
  return [
    `Tool name: ${binding.definition.name}`,
    `Agent tool name: ${binding.agentToolName}`,
    `Title: ${binding.definition.title}`,
    `Description: ${binding.definition.description}`,
    `Access: ${binding.definition.access}`,
    `Display: ${JSON.stringify(binding.display, null, 2)}`,
    `Presentation: ${JSON.stringify(binding.presentation, null, 2)}`,
    `Input schema JSON: ${formatToolSchema(binding)}`
  ].join("\n")
}

function buildLoadedExtensionToolDetailsSection(bindings: ExtensionAgentToolBinding[]): string {
  if (bindings.length === 0) {
    return "Tool details: none."
  }

  return [
    "Tool details:",
    ...bindings.map((binding) => `\n${buildLoadedExtensionToolDetails(binding)}`)
  ].join("\n")
}

function getModelCapabilityTitle(resolvedCapability: ResolvedExtensionAiCapability): string {
  return resolveLocalizedText(
    resolvedCapability.capability.title,
    "en-US",
    resolvedCapability.extensionName
  )
}

function buildLoadedCapabilityGuide(input: {
  aiToolBindings?: ExtensionAgentToolBinding[]
  resolvedCapability: ResolvedExtensionAiCapability
}): string {
  const resolvedCapability = input.resolvedCapability
  const callableToolNames =
    input.aiToolBindings?.map((binding) => binding.definition.name) ??
    resolvedCapability.toolExposures.map((toolExposure) => toolExposure.toolName)
  const callableStatus =
    resolvedCapability.authStatus === "connected" && callableToolNames.length > 0
      ? `Callable tools: ${callableToolNames.join(", ")}`
      : resolvedCapability.authStatus === "connected"
        ? "Callable tools: none"
        : `Callable tools: none; auth status is ${resolvedCapability.authStatus}`
  const description = resolveLocalizedText(resolvedCapability.capability.description, "en-US", "")

  return [
    `Extension AI capability: ${getModelCapabilityTitle(resolvedCapability)}`,
    `Extension name: ${resolvedCapability.extensionName}`,
    `Permission Mode: ${resolvedCapability.permissionMode}`,
    callableStatus,
    description ? `Description: ${description}` : null,
    `Call loadExtension to load full tool details and input schemas before ${CALL_EXTENSION_TOOL_NAME}.`
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
}

function buildExtensionCatalogSection(catalog: ExtensionAiCapabilityCatalogItem[]): string {
  if (catalog.length === 0) {
    return ""
  }

  return [
    "### Extension Capability Catalog",
    `This is a lightweight catalog. It intentionally omits full input schemas. Use loadExtension(extensionName) to load one extension's full tool details and schemas, then use ${CALL_EXTENSION_TOOL_NAME} to execute a loaded tool.`,
    ...catalog.map((item) =>
      [
        `- ${item.title}`,
        `  extensionName: ${item.extensionName}`,
        item.mention ? `  @mention: @${item.mention.value}` : "  @mention: none",
        `  capability title: ${item.title}`,
        `  capability description: ${item.description}`,
        `  capability guide: ${item.guide}`,
        `  toolNames: ${item.toolNames.length > 0 ? item.toolNames.join(", ") : "none"}`,
        ...item.tools.map((toolSummary) =>
          [
            `  - tool: ${toolSummary.toolName}`,
            `    title: ${toolSummary.title}`,
            `    description: ${toolSummary.description}`,
            `    access: ${toolSummary.access ?? "unknown"}`
          ].join("\n")
        )
      ].join("\n")
    )
  ].join("\n")
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
        `Extension AI capability: ${getModelCapabilityTitle(resolvedCapability)}`,
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
  aiToolBindings?: ExtensionAgentToolBinding[]
): string {
  const sections = aiCapabilities
    .filter(
      (resolvedCapability) =>
        resolvedCapability.enabled || resolvedCapability.authStatus !== "connected"
    )
    .map((resolvedCapability) =>
      buildLoadedCapabilityGuide({
        aiToolBindings: aiToolBindings?.filter(
          (toolBinding) =>
            toolBinding.resolvedCapability.extensionName === resolvedCapability.extensionName &&
            toolBinding.resolvedCapability.capability.id === resolvedCapability.capability.id
        ),
        resolvedCapability
      })
    )

  if (sections.length === 0) {
    return ""
  }

  return ["### Extension AI Capability Guides", ...sections.map((section) => `\n${section}`)].join(
    "\n"
  )
}

function buildSessionPromptSections(options: CreateExtensionAiMiddlewareOptions): string[] {
  const loadedCapabilities = options.session.getAiCapabilities()
  const loadedBindings = options.session.getVisibleToolBindings()
  return [
    buildExtensionCatalogSection(options.aiCapabilityCatalog),
    buildExtensionInstructions(loadedCapabilities),
    buildExtensionAiCapabilityGuide(loadedCapabilities, loadedBindings)
  ].filter((section) => section.trim().length > 0)
}

function buildLoadExtensionOutput(input: {
  bindings: ExtensionAgentToolBinding[]
  loaded: boolean
  resolvedCapability: ResolvedExtensionAiCapability
}): string {
  const { bindings, loaded, resolvedCapability } = input
  const description = resolveLocalizedText(resolvedCapability.capability.description, "en-US", "")

  return [
    `${loaded ? "Loaded extension" : "Extension already loaded"}: ${getModelCapabilityTitle(resolvedCapability)}`,
    `Extension name: ${resolvedCapability.extensionName}`,
    `Capability title: ${getModelCapabilityTitle(resolvedCapability)}`,
    description ? `Capability description: ${description}` : null,
    `Capability guide: ${resolvedCapability.capability.guide}`,
    `Auth status: ${resolvedCapability.authStatus}`,
    `Enabled: ${resolvedCapability.enabled ? "yes" : "no"}`,
    `Permission mode: ${resolvedCapability.permissionMode}`,
    buildLoadedExtensionToolListSection(bindings),
    buildLoadedExtensionToolDetailsSection(bindings),
    `Use ${CALL_EXTENSION_TOOL_NAME} with extensionName, toolName, and args matching the loaded input schema JSON.`
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n")
}

function serializeRecoverableExtensionToolValidationError(input: {
  error: ToolSchemaValidationError
  extensionName: string
  toolName: string
}): string {
  return JSON.stringify(
    {
      code: "validation_error",
      extensionName: input.extensionName,
      issues: input.error.issues,
      message: input.error.message,
      nextAction:
        "Retry callExtension with args matching this extension tool's loaded input schema.",
      status: "error",
      toolName: input.toolName
    },
    null,
    2
  )
}

async function persistLoadedCapabilities(input: {
  onLoadedAiCapabilitiesChanged?: (
    change: LoadedExtensionAiCapabilitiesChange
  ) => Promise<void> | void
  runId: string | null
  session: ExtensionAiSession
}): Promise<void> {
  if (!input.runId || !input.onLoadedAiCapabilitiesChanged) {
    return
  }

  await input.onLoadedAiCapabilitiesChanged({
    aiCapabilities: input.session.getAiCapabilities(),
    runId: input.runId
  })
}

export function createExtensionAiMiddleware(options: CreateExtensionAiMiddlewareOptions) {
  const loadExtensionTool = tool(
    async (input, runtime: ToolRuntime) => {
      const existingCapability = options.session
        .getAiCapabilities()
        .find((capability) => capability.extensionName === input.extensionName)
      if (existingCapability) {
        const bindings = options.session
          .getVisibleToolBindings()
          .filter((binding) => binding.resolvedCapability.extensionName === input.extensionName)

        return buildLoadExtensionOutput({
          bindings,
          loaded: false,
          resolvedCapability: existingCapability
        })
      }

      const resolvedCapability = options.getAiCapabilityByExtensionName?.(input.extensionName)
      if (!resolvedCapability) {
        return `Unknown extension "${input.extensionName}". Use one of: ${options.aiCapabilityCatalog
          .map((item) => item.extensionName)
          .join(", ")}.`
      }

      options.session.loadAiCapability(resolvedCapability)
      const runId = getRunIdFromToolRuntime(runtime) ?? options.runId ?? null
      await persistLoadedCapabilities({
        onLoadedAiCapabilitiesChanged: options.onLoadedAiCapabilitiesChanged,
        runId,
        session: options.session
      })

      const bindings = options.session
        .getVisibleToolBindings()
        .filter(
          (binding) => binding.resolvedCapability.extensionName === resolvedCapability.extensionName
        )

      return buildLoadExtensionOutput({
        bindings,
        loaded: true,
        resolvedCapability
      })
    },
    {
      description: `Load one extension by extensionName. Returns that extension's full callable tool details, input schemas, display metadata, auth status, and permission state, and makes those tools available to ${CALL_EXTENSION_TOOL_NAME} in the current session.`,
      name: "loadExtension",
      schema: loadExtensionInputSchema
    }
  )
  const callExtension = tool(
    async (input, runtime: ToolRuntime) => {
      const binding = findBinding({
        extensionName: input.extensionName,
        session: options.session,
        toolName: input.toolName
      })
      if (!binding) {
        return `Extension tool unavailable: ${input.extensionName}.${input.toolName}. Call loadExtension first, check auth status, and use a callable tool listed in the loaded extension guide.`
      }

      const runId = getRunIdFromToolRuntime(runtime) ?? options.runId ?? null
      const toolCallId = getToolCallIdFromRuntime(runtime)
      let result
      try {
        result = await new ExtensionToolExecutor({
          bindings: options.session.getVisibleToolBindings(),
          getExtensionExecutionContext: options.getExtensionExecutionContext,
          getExtensionPreferences: options.getExtensionPreferences
        }).executeAgentToolWithResult({
          agentToolName: binding.agentToolName,
          args: input.args,
          runId,
          threadId: options.threadId,
          workspacePath: options.workspacePath
        })
      } catch (error) {
        if (error instanceof ToolSchemaValidationError) {
          return serializeRecoverableExtensionToolValidationError({
            error,
            extensionName: input.extensionName,
            toolName: input.toolName
          })
        }

        throw error
      }

      if (result.outputs.length === 0) {
        return result.serializedOutput
      }

      if (!toolCallId) {
        throw new Error("Extension tool outputs require a tool call id.")
      }

      const artifactUpdate = await presentExtensionToolOutputs({
        outputs: result.outputs,
        runId,
        threadId: options.threadId,
        toolCallId,
        workspacePath: options.workspacePath
      })

      return new Command({
        update: {
          artifacts: artifactUpdate,
          messages: [
            new ToolMessage({
              content: result.serializedOutput,
              name: CALL_EXTENSION_TOOL_NAME,
              tool_call_id: toolCallId
            })
          ]
        }
      })
    },
    {
      description:
        "Execute a tool from a loaded extension. Call loadExtension first to load the extension's full tool details and input schemas, then pass extensionName, toolName, and args.",
      name: CALL_EXTENSION_TOOL_NAME,
      schema: callExtensionInputSchema
    }
  )

  return createMiddleware({
    name: "openworkExtensionAiCapabilities",
    tools: [loadExtensionTool, callExtension],
    wrapModelCall: async (request, handler) => {
      const promptSections = buildSessionPromptSections(options)
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
          if (toolCall.name !== CALL_EXTENSION_TOOL_NAME) {
            return toolCall
          }

          const parsedArgs = callExtensionInputSchema.safeParse(toolCall.args)
          const binding = parsedArgs.success
            ? findBinding({
                extensionName: parsedArgs.data.extensionName,
                session: options.session,
                toolName: parsedArgs.data.toolName
              })
            : null
          if (!binding) {
            return toolCall
          }

          const ui = extensionToolCallUiSchema.parse({
            display: binding.display,
            presentation: binding.presentation
          })
          return {
            ...toolCall,
            display: ui.display,
            presentation: ui.presentation
          }
        }),
        usage_metadata: response.usage_metadata
      })
    }
  })
}
