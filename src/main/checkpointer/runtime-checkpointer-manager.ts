import { createJingleCheckpointerManager } from "@jingle/langchain-agent-harness/transitional"
import { flushAgentTraceProjection } from "../db/agent-events"
import { flushMessageSearchProjection, RuntimeCheckpointSaver } from "./runtime-checkpointer"

const checkpointerManager = createJingleCheckpointerManager({
  async createCheckpointer() {
    const checkpointer = new RuntimeCheckpointSaver()
    await checkpointer.initialize()
    return checkpointer
  },
  flushOnCloseAll: [flushAgentTraceProjection, flushMessageSearchProjection]
})

export async function getCheckpointer(threadId: string): Promise<RuntimeCheckpointSaver> {
  return checkpointerManager.get(threadId)
}

export async function closeCheckpointer(threadId: string): Promise<void> {
  await checkpointerManager.close(threadId)
}

export async function closeRuntimeCheckpointers(): Promise<void> {
  await checkpointerManager.closeAll()
}

export function runtimeUsesCheckpointPersistence(): boolean {
  return process.env.JINGLE_BDD_AGENT_RUNTIME !== "scripted"
}
