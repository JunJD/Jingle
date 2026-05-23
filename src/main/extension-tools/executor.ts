import { parseToolInputWithSchema } from "../agent/tool-input-schema"
import type { ExtensionAgentToolBinding } from "./registry"

const DEFAULT_MAX_AGENT_OUTPUT_CHARS = 12_000

export interface ExecuteExtensionAgentToolInput {
  agentToolName: string
  args: unknown
  runId?: string | null
  threadId: string
  workspacePath: string
}

export interface ExtensionToolExecutorOptions {
  bindings: ExtensionAgentToolBinding[]
  maxAgentOutputChars?: number
}

function serializeExtensionToolOutput(value: unknown, maxChars: number): string {
  const serialized =
    typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2)

  if (serialized.length <= maxChars) {
    return serialized
  }

  return `${serialized.slice(0, maxChars)}\n\n[Openwork truncated extension tool output.]`
}

export class ExtensionToolExecutor {
  private readonly bindingsByAgentToolName: Map<string, ExtensionAgentToolBinding>
  private readonly maxAgentOutputChars: number

  constructor(options: ExtensionToolExecutorOptions) {
    this.bindingsByAgentToolName = new Map(
      options.bindings.map((binding) => [binding.agentToolName, binding])
    )
    this.maxAgentOutputChars = options.maxAgentOutputChars ?? DEFAULT_MAX_AGENT_OUTPUT_CHARS
  }

  getBinding(agentToolName: string): ExtensionAgentToolBinding | null {
    return this.bindingsByAgentToolName.get(agentToolName) ?? null
  }

  async executeAgentTool(input: ExecuteExtensionAgentToolInput): Promise<string> {
    const binding = this.getBinding(input.agentToolName)
    if (!binding) {
      throw new Error(`Unknown extension agent tool "${input.agentToolName}".`)
    }

    const parsedInput = await parseToolInputWithSchema(
      input.agentToolName,
      binding.definition.inputSchema,
      input.args
    )

    const result = await binding.definition.handler(
      {
        agentToolName: input.agentToolName,
        capabilityId: binding.capability.id,
        extensionName: binding.definition.extensionName,
        runId: input.runId,
        threadId: input.threadId,
        toolName: binding.definition.name,
        workspacePath: input.workspacePath
      },
      parsedInput
    )

    return serializeExtensionToolOutput(result, this.maxAgentOutputChars)
  }
}
