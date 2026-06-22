import { createProjectionQueue } from "./projection-queue"
import { markThreadDigestProjectionFailed, projectThreadDigest } from "./thread-digest-projection"

const THREAD_DIGEST_PROJECTION_DEBOUNCE_MS = 500

const threadDigestProjectionQueue = createProjectionQueue<string>({
  debounceMs: THREAD_DIGEST_PROJECTION_DEBOUNCE_MS,
  getKey: (threadId) => threadId,
  name: "ThreadDigestProjector",
  onError: async (threadId, error) => {
    await markThreadDigestProjectionFailed(threadId, error)
  },
  run: async (threadId) => {
    await projectThreadDigest(threadId)
  },
  stateKey: "thread-digest"
})

export function enqueueThreadDigestProjection(threadId: string): void {
  threadDigestProjectionQueue.enqueue(threadId)
}

export async function flushThreadDigestProjection(): Promise<void> {
  await threadDigestProjectionQueue.flush()
}

export { setThreadDigestGeneratorForTests } from "./thread-digest-projection"
