import { Command, END, Send, isCommand } from "@langchain/langgraph"

export const LEGACY_MODEL_REQUEST_NODE_NAME = "model_request"
export const LEGACY_TOOLS_NODE_NAME = "tools"

export interface RuntimeDestinationMappingInput {
  readonly exitNode: string
  readonly modelEntryNode: string
  readonly permissionGateNode: string
}

export function parseRuntimeJumpTarget(target?: string): string | undefined {
  if (!target) return
  if ([LEGACY_MODEL_REQUEST_NODE_NAME, LEGACY_TOOLS_NODE_NAME, END].includes(target)) {
    return target
  }
  if (target === "model") return LEGACY_MODEL_REQUEST_NODE_NAME
  if (target === "tools") return LEGACY_TOOLS_NODE_NAME
  if (target === "end") return END
  throw new Error(`Invalid jump target: ${target}, must be "model", "tools" or "end".`)
}

export function mapRuntimeDestination(
  destination: string | undefined,
  input: RuntimeDestinationMappingInput
): string {
  if (!destination) return input.modelEntryNode
  if (destination === END) return input.exitNode
  if (destination === LEGACY_MODEL_REQUEST_NODE_NAME) return input.modelEntryNode
  if (destination === LEGACY_TOOLS_NODE_NAME) return input.permissionGateNode
  return destination
}

function rewriteLegacyGraphDestination(
  destination: string,
  input: {
    readonly modelEntryNode: string
    readonly permissionGateNode: string
  }
): string {
  if (destination === LEGACY_MODEL_REQUEST_NODE_NAME) return input.modelEntryNode
  if (destination === LEGACY_TOOLS_NODE_NAME) return input.permissionGateNode
  return destination
}

function rewriteLegacyGraphOutputDestination(
  output: unknown,
  input: {
    readonly modelEntryNode: string
    readonly permissionGateNode: string
  }
): unknown {
  if (output instanceof Send) {
    return new Send(rewriteLegacyGraphDestination(output.node, input), output.args)
  }

  if (isCommand(output)) {
    if (output.graph) return output

    const goto = (Array.isArray(output.goto) ? output.goto : output.goto ? [output.goto] : []).map(
      (destination) => {
        if (destination instanceof Send) {
          return new Send(rewriteLegacyGraphDestination(destination.node, input), destination.args)
        }
        return rewriteLegacyGraphDestination(destination, input)
      }
    )

    return new Command({
      update: output.update,
      ...(output.resume !== undefined ? { resume: output.resume } : {}),
      ...(goto.length > 0 ? { goto } : {})
    })
  }

  return output
}

export function rewriteLegacyGraphOutput(
  output: unknown,
  input: {
    readonly modelEntryNode: string
    readonly permissionGateNode: string
  }
): unknown {
  if (Array.isArray(output))
    return output.map((destination) => rewriteLegacyGraphOutputDestination(destination, input))
  return rewriteLegacyGraphOutputDestination(output, input)
}
