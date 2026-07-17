import type {
  ExtensionRuntimeStopResult,
  RuntimeCacheBackend
} from "@jingle/extension-api/host-runtime"

export interface ExtensionRuntimeCacheLifecycle {
  bindSession: (sessionId: string) => void
  flushBeforeReady: (sessionId: string) => Promise<boolean>
  stop: (sessionId: string) => Promise<ExtensionRuntimeStopResult>
}

export function createExtensionRuntimeCacheLifecycle(
  backend: RuntimeCacheBackend | null,
  options: { onPersistenceFailure: (sessionId: string) => void }
): ExtensionRuntimeCacheLifecycle {
  let activeSessionId: string | null = null
  let failed = false
  let reportedFailureSessionId: string | null = null

  const reportFailure = (): void => {
    failed = true
    if (!activeSessionId || reportedFailureSessionId === activeSessionId) {
      return
    }
    reportedFailureSessionId = activeSessionId
    try {
      options.onPersistenceFailure(activeSessionId)
    } catch {
      // The typed stop result remains authoritative if the immediate projection cannot be sent.
    }
  }

  backend?.onFailure(reportFailure)

  const assertBoundSession = (sessionId: string): void => {
    if (activeSessionId !== sessionId) {
      throw new Error("Extension runtime cache lifecycle is not bound to this session.")
    }
  }

  const flush = async (sessionId: string): Promise<boolean> => {
    assertBoundSession(sessionId)
    if (failed) {
      reportFailure()
      return false
    }
    try {
      await backend?.flush()
      return true
    } catch {
      reportFailure()
      return false
    }
  }

  const close = async (sessionId: string): Promise<boolean> => {
    assertBoundSession(sessionId)
    if (failed) {
      reportFailure()
      return false
    }
    try {
      await backend?.close()
      return !failed
    } catch {
      reportFailure()
      return false
    }
  }

  return {
    bindSession(sessionId) {
      if (activeSessionId && activeSessionId !== sessionId) {
        throw new Error("Extension runtime cache lifecycle is already bound to another session.")
      }
      activeSessionId = sessionId
      if (failed) {
        reportFailure()
      }
    },
    flushBeforeReady: flush,
    async stop(sessionId) {
      return (await close(sessionId)) ? { kind: "flushed" } : { kind: "cache-persistence-failed" }
    }
  }
}
