import { buildIpcErrorEvent } from "../ipc/error"
import type { AgentStreamSink } from "./service"

export function startAgentStreamOperation(
  operation: "invoke" | "resume",
  sink: AgentStreamSink,
  action: Promise<void>
): void {
  void action.catch((error) => {
    console.error(`[Agent] ${operation} request failed:`, error)
    sink.send({
      type: "error",
      ...buildIpcErrorEvent(`agent:${operation}`, error)
    })
  })
}
