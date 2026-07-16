import type {
  ExtensionAiCapabilityCatalogItem,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { NativeExtensionExecutionContext } from "@shared/native-extensions"
import { resolveLocalizedText } from "@shared/i18n"
import { extensionToolCallUiSchema } from "@shared/tool-presentation"
import { ToolSchemaValidationError } from "./tool-input-schema"
import { presentExtensionToolOutputs } from "../artifacts/extension-tool-outputs"
import { ExtensionToolExecutor } from "../extension-tools/executor"
import type { ExtensionAgentToolBinding } from "../extension-tools/registry"
import { JINGLE_CALL_EXTENSION_TOOL_NAME } from "@jingle/langchain-agent-harness/transitional"
import type { RuntimeExtensionToolsConfig } from "@jingle/langchain-agent-harness"
import type {
  ExtensionAiSession,
  LoadedExtensionAiCapabilitiesChange
} from "./extension-ai-session"

export interface CreateExtensionAiToolsPortOptionsInput {
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
    `Call loadExtension to load full tool details and input schemas before ${JINGLE_CALL_EXTENSION_TOOL_NAME}.`
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
    `This is a lightweight catalog. It intentionally omits full input schemas. Use loadExtension(extensionName) to load one extension's full tool details and schemas, then use ${JINGLE_CALL_EXTENSION_TOOL_NAME} to execute a loaded tool.`,
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
  const sections: string[] = []
  for (const resolvedCapability of aiCapabilities) {
    if (!resolvedCapability.enabled && resolvedCapability.authStatus === "connected") {
      continue
    }

    const capabilityToolBindings: ExtensionAgentToolBinding[] = []
    for (const toolBinding of aiToolBindings ?? []) {
      if (
        toolBinding.resolvedCapability.extensionName === resolvedCapability.extensionName &&
        toolBinding.resolvedCapability.capability.id === resolvedCapability.capability.id
      ) {
        capabilityToolBindings.push(toolBinding)
      }
    }

    sections.push(
      buildLoadedCapabilityGuide({
        aiToolBindings: capabilityToolBindings,
        resolvedCapability
      })
    )
  }

  if (sections.length === 0) {
    return ""
  }

  return ["### Extension AI Capability Guides", ...sections.map((section) => `\n${section}`)].join(
    "\n"
  )
}

function buildSessionPromptSections(options: CreateExtensionAiToolsPortOptionsInput): string[] {
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
    `Use ${JINGLE_CALL_EXTENSION_TOOL_NAME} with extensionName, toolName, and args matching the loaded input schema JSON.`
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

export function createExtensionAiToolsPortOptions(
  options: CreateExtensionAiToolsPortOptionsInput
): RuntimeExtensionToolsConfig {
  return {
    buildPromptSections: () => buildSessionPromptSections(options),
    loadExtension: async (input, context) => {
      const existingCapability = options.session
        .getAiCapabilities()
        .find((capability) => capability.extensionName === input.extensionName)
      if (existingCapability) {
        const bindings = options.session
          .getVisibleToolBindings()
          .filter((binding) => binding.resolvedCapability.extensionName === input.extensionName)

        return {
          content: buildLoadExtensionOutput({
            bindings,
            loaded: false,
            resolvedCapability: existingCapability
          })
        }
      }

      const resolvedCapability = options.getAiCapabilityByExtensionName?.(input.extensionName)
      if (!resolvedCapability) {
        return {
          content: `Unknown extension "${input.extensionName}". Use one of: ${options.aiCapabilityCatalog
            .map((item) => item.extensionName)
            .join(", ")}.`
        }
      }

      options.session.loadAiCapability(resolvedCapability)
      const runId = context.runId ?? options.runId ?? null
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

      return {
        content: buildLoadExtensionOutput({
          bindings,
          loaded: true,
          resolvedCapability
        })
      }
    },
    callExtension: async (input, context) => {
      const binding = findBinding({
        extensionName: input.extensionName,
        session: options.session,
        toolName: input.toolName
      })
      if (!binding) {
        return {
          content: `Extension tool unavailable: ${input.extensionName}.${input.toolName}. Call loadExtension first, check auth status, and use a callable tool listed in the loaded extension guide.`
        }
      }

      const runId = context.runId ?? options.runId ?? null
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
          return {
            content: serializeRecoverableExtensionToolValidationError({
              error,
              extensionName: input.extensionName,
              toolName: input.toolName
            })
          }
        }

        throw error
      }

      if (result.outputs.length === 0) {
        return {
          content: result.serializedOutput
        }
      }

      if (!context.toolCallId) {
        throw new Error("Extension tool outputs require a tool call id.")
      }

      const artifactUpdate = await presentExtensionToolOutputs({
        outputs: result.outputs,
        runId,
        threadId: options.threadId,
        toolCallId: context.toolCallId,
        workspacePath: options.workspacePath
      })

      return {
        content: result.serializedOutput,
        stateUpdate: {
          artifacts: artifactUpdate
        }
      }
    },
    resolveCallExtensionToolUi: (input) => {
      const binding = findBinding({
        extensionName: input.extensionName,
        session: options.session,
        toolName: input.toolName
      })
      if (!binding) {
        return null
      }

      const ui = extensionToolCallUiSchema.parse({
        display: binding.display,
        presentation: binding.presentation
      })
      return {
        display: ui.display,
        presentation: ui.presentation
      }
    }
  }
}
