import { createProjectionQueue } from "../projection/projection-queue"
import { finalizeAssistantContentPartsForRun } from "../db/assistant-content-parts"

interface AssistantContentProjectionJob {
  runId: string
  threadId: string
}

const assistantContentProjectionQueue = createProjectionQueue<AssistantContentProjectionJob>({
  debounceMs: 0,
  getKey: (job) => `${job.threadId}:${job.runId}`,
  name: "AssistantContentProjector",
  onError: (job, error) => {
    console.error("[AssistantContentProjector] Projection job failed.", {
      error,
      runId: job.runId,
      threadId: job.threadId
    })
  },
  run: finalizeAssistantContentPartsForRun,
  stateKey: "assistant-content-parts"
})

export function enqueueAssistantContentProjection(job: AssistantContentProjectionJob): void {
  assistantContentProjectionQueue.enqueue(job)
}

export async function flushAssistantContentProjection(): Promise<void> {
  await assistantContentProjectionQueue.flush()
}
