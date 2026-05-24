import { AIMessage } from "@langchain/core/messages"
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import type {
  ExtensionAiCapabilityCatalogItem,
  PermissionModeName,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import { extensionToolCallUiSchema } from "@shared/tool-presentation"
import { z } from "./tool-input-schema"
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
  getExtensionPreferences?: (extensionName: string) => Record<string, unknown>
  onLoadedAiCapabilitiesChanged?: (
    change: LoadedExtensionAiCapabilitiesChange
  ) => Promise<void> | void
  permissionMode?: PermissionModeName
  runId?: string | null
  session: ExtensionAiSession
  threadId: string
  workspacePath: string
}

const callExtensionToolInputSchema = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
  extensionName: z.string().trim().min(1),
  toolName: z.string().trim().min(1)
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
          (binding.definition.name === requestedToolName ||
            binding.agentToolName === requestedToolName)
      ) ?? null
  )
}

function formatToolSchema(binding: ExtensionAgentToolBinding): string {
  const schema = binding.definition.inputSchema as { toJSONSchema?: () => unknown }
  const jsonSchema = schema.toJSONSchema?.()
  return JSON.stringify(jsonSchema ?? { type: "object" }, null, 2)
}

function buildLoadedExtensionToolsSection(bindings: ExtensionAgentToolBinding[]): string {
  if (bindings.length === 0) {
    return "Callable tools: none."
  }

  return [
    "Callable tools:",
    ...bindings.map((binding) =>
      [
        `- ${binding.definition.name}: ${binding.display.description}`,
        `  Access: ${binding.definition.access}`,
        `  Input schema: ${formatToolSchema(binding)}`
      ].join("\n")
    )
  ].join("\n")
}

function buildLoadedCapabilityGuide(input: {
  aiToolBindings?: ExtensionAgentToolBinding[]
  permissionMode?: PermissionModeName
  resolvedCapability: ResolvedExtensionAiCapability
}): string {
  const resolvedCapability = input.resolvedCapability
  const callableToolNames =
    input.aiToolBindings?.map((binding) => binding.display.title) ??
    resolvedCapability.toolExposures.map((toolExposure) => toolExposure.display.title)
  const callableStatus =
    resolvedCapability.authStatus === "connected" && callableToolNames.length > 0
      ? `Callable tools: ${callableToolNames.join(", ")}`
      : resolvedCapability.authStatus === "connected"
        ? "Callable tools: none"
        : `Callable tools: none; auth status is ${resolvedCapability.authStatus}`

  return [
    `Extension AI capability: ${resolvedCapability.capability.title}`,
    `Extension name: ${resolvedCapability.extensionName}`,
    `Permission Mode: ${input.permissionMode ?? resolvedCapability.permissionMode}`,
    callableStatus,
    resolvedCapability.capability.guide
  ].join("\n")
}

function buildExtensionCatalogSection(input: {
  catalog: ExtensionAiCapabilityCatalogItem[]
  loadedCapabilities: ResolvedExtensionAiCapability[]
}): string {
  const loadedExtensionNames = new Set(
    input.loadedCapabilities.map((capability) => capability.extensionName)
  )
  const catalog = input.catalog.filter((item) => !loadedExtensionNames.has(item.extensionName))
  if (catalog.length === 0) {
    return ""
  }

  return [
    "### Available Extensions",
    "Use loadExtension only for one of the extensions listed below. If an extension already appears in Extension AI Capability Guides, it is already loaded; use callExtensionTool directly.",
    ...catalog.map((item) =>
      [
        `- ${item.title} (${item.extensionName})`,
        `  Source id: ${item.sourceId}`,
        `  Description: ${item.description}`,
        item.mention ? `  Mention: @${item.mention.value}` : null
      ]
        .filter((line): line is string => line !== null)
        .join("\n")
    )
  ].join("\n")
}

function getLoadedExtensionNames(session: ExtensionAiSession): Set<string> {
  return new Set(session.getAiCapabilities().map((capability) => capability.extensionName))
}

function getLoadableCatalogItems(options: CreateExtensionAiMiddlewareOptions) {
  const loadedExtensionNames = getLoadedExtensionNames(options.session)
  return options.aiCapabilityCatalog.filter((item) => !loadedExtensionNames.has(item.extensionName))
}

function createLoadExtensionInputSchema(loadableItems: ExtensionAiCapabilityCatalogItem[]) {
  const extensionNames = loadableItems.map((item) => item.extensionName)
  if (extensionNames.length === 0) {
    return z.object({
      extensionName: z.string().trim().min(1)
    })
  }

  return z.object({
    extensionName: z.enum(extensionNames as [string, ...string[]])
  })
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
    .map((resolvedCapability) =>
      buildLoadedCapabilityGuide({
        aiToolBindings: aiToolBindings?.filter(
          (toolBinding) =>
            toolBinding.resolvedCapability.extensionName === resolvedCapability.extensionName &&
            toolBinding.resolvedCapability.capability.id === resolvedCapability.capability.id
        ),
        permissionMode,
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
    buildExtensionCatalogSection({
      catalog: options.aiCapabilityCatalog,
      loadedCapabilities
    }),
    buildExtensionInstructions(loadedCapabilities),
    buildExtensionAiCapabilityGuide(loadedCapabilities, options.permissionMode, loadedBindings)
  ].filter((section) => section.trim().length > 0)
}

async function persistLoadedCapabilities(input: {
  onLoadedAiCapabilitiesChanged?: (
    change: LoadedExtensionAiCapabilitiesChange
  ) => Promise<void> | void
  permissionMode?: PermissionModeName
  runId: string | null
  session: ExtensionAiSession
}): Promise<void> {
  if (!input.runId || !input.onLoadedAiCapabilitiesChanged) {
    return
  }

  await input.onLoadedAiCapabilitiesChanged({
    aiCapabilities: input.session.getAiCapabilities(),
    permissionMode: input.permissionMode ?? DEFAULT_PERMISSION_MODE,
    runId: input.runId
  })
}

export function createExtensionAiMiddleware(options: CreateExtensionAiMiddlewareOptions) {
  function createCurrentLoadExtensionTool() {
    const loadExtensionInputSchema = createLoadExtensionInputSchema(
      getLoadableCatalogItems(options)
    )
    return tool(
      async (input, runtime: ToolRuntime) => {
        const existingCapability = options.session
          .getAiCapabilities()
          .find((capability) => capability.extensionName === input.extensionName)
        if (existingCapability) {
          const bindings = options.session
            .getVisibleToolBindings()
            .filter((binding) => binding.resolvedCapability.extensionName === input.extensionName)

          return [
            `Extension already loaded: ${existingCapability.capability.title}`,
            `Extension name: ${existingCapability.extensionName}`,
            buildLoadedCapabilityGuide({
              aiToolBindings: bindings,
              permissionMode: options.permissionMode,
              resolvedCapability: existingCapability
            }),
            buildLoadedExtensionToolsSection(bindings),
            "Use callExtensionTool directly."
          ].join("\n\n")
        }

        const resolvedCapability = options.getAiCapabilityByExtensionName?.(input.extensionName)
        if (!resolvedCapability) {
          return `Unknown or already loaded extension "${input.extensionName}". Use one of: ${getLoadableCatalogItems(
            options
          )
            .map((item) => item.extensionName)
            .join(", ")}.`
        }

        options.session.loadAiCapability(resolvedCapability)
        const runId = getRunIdFromToolRuntime(runtime) ?? options.runId ?? null
        await persistLoadedCapabilities({
          onLoadedAiCapabilitiesChanged: options.onLoadedAiCapabilitiesChanged,
          permissionMode: options.permissionMode,
          runId,
          session: options.session
        })

        const bindings = options.session
          .getVisibleToolBindings()
          .filter(
            (binding) =>
              binding.resolvedCapability.extensionName === resolvedCapability.extensionName
          )

        return [
          `Loaded extension: ${resolvedCapability.capability.title}`,
          `Extension name: ${resolvedCapability.extensionName}`,
          `Auth status: ${resolvedCapability.authStatus}`,
          `Enabled: ${resolvedCapability.enabled ? "yes" : "no"}`,
          buildLoadedCapabilityGuide({
            aiToolBindings: bindings,
            permissionMode: options.permissionMode,
            resolvedCapability
          }),
          buildLoadedExtensionToolsSection(bindings)
        ].join("\n\n")
      },
      {
        description:
          "Load one extension when the user's request belongs to an available extension. Loading reveals its full instructions, guide, auth status, and callable tool documentation.",
        name: "loadExtension",
        schema: loadExtensionInputSchema
      }
    )
  }

  const loadExtensionTool = createCurrentLoadExtensionTool()
  const callExtensionTool = tool(
    async (input, runtime: ToolRuntime) => {
      const binding = findBinding({
        extensionName: input.extensionName,
        session: options.session,
        toolName: input.toolName
      })
      if (!binding) {
        return `Extension tool unavailable: ${input.extensionName}.${input.toolName}. Call loadExtension first, check auth status, and use a callable tool listed in the loaded extension guide.`
      }

      return new ExtensionToolExecutor({
        bindings: options.session.getVisibleToolBindings(),
        getExtensionPreferences: options.getExtensionPreferences
      }).executeAgentTool({
        agentToolName: binding.agentToolName,
        args: input.args,
        runId: getRunIdFromToolRuntime(runtime) ?? options.runId,
        threadId: options.threadId,
        workspacePath: options.workspacePath
      })
    },
    {
      description:
        "Execute a tool from a loaded extension. Use only tools listed after loadExtension or an explicit @ mention. Pass extensionName, toolName, and args matching the loaded tool documentation.",
      name: "callExtensionTool",
      schema: callExtensionToolInputSchema
    }
  )

  return createMiddleware({
    name: "openworkExtensionAiCapabilities",
    tools: [loadExtensionTool, callExtensionTool],
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
          if (toolCall.name !== "callExtensionTool") {
            return toolCall
          }

          const parsedArgs = callExtensionToolInputSchema.safeParse(toolCall.args)
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
