import {
  threadDigestChangedEventSchema,
  threadDigestRecordSchema,
  type ThreadDigestChangedEvent,
  type ThreadDigestRecord,
  type ThreadDigestRequest
} from "@shared/thread-digest"
import { invokeIpc, ipcRenderer } from "../ipc"

export const threadDigestApi = {
  onChanged: (listener: (event: ThreadDigestChangedEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => {
      const parsed = threadDigestChangedEventSchema.safeParse(payload)
      if (!parsed.success) {
        console.error("[ThreadDigest] Ignored an invalid change event.")
        return
      }

      listener(parsed.data)
    }
    ipcRenderer.on("threadDigest:changed", handler)
    return () => ipcRenderer.removeListener("threadDigest:changed", handler)
  },
  get: async (input: ThreadDigestRequest): Promise<ThreadDigestRecord | null> => {
    return threadDigestRecordSchema.nullable().parse(await invokeIpc("threadDigest:get", input))
  },
  generate: async (input: ThreadDigestRequest): Promise<ThreadDigestRecord> => {
    return threadDigestRecordSchema.parse(await invokeIpc("threadDigest:generate", input))
  }
}
