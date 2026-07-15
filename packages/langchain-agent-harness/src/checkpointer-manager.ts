export interface JingleRuntimeCheckpointer {
  close(): Promise<void>
}

export interface CreateJingleCheckpointerManagerInput<
  TCheckpointer extends JingleRuntimeCheckpointer
> {
  createCheckpointer(): Promise<TCheckpointer>
  flushOnCloseAll?: Array<() => Promise<void>>
}

export interface JingleCheckpointerManager<TCheckpointer extends JingleRuntimeCheckpointer> {
  close(threadId: string): Promise<void>
  closeAll(): Promise<void>
  get(threadId: string): Promise<TCheckpointer>
}

interface JingleCheckpointerEntry<TCheckpointer extends JingleRuntimeCheckpointer> {
  closeOperation: Promise<void> | null
  creation: Promise<TCheckpointer>
}

export function createJingleCheckpointerManager<TCheckpointer extends JingleRuntimeCheckpointer>(
  input: CreateJingleCheckpointerManagerInput<TCheckpointer>
): JingleCheckpointerManager<TCheckpointer> {
  const entries = new Map<string, JingleCheckpointerEntry<TCheckpointer>>()
  let closeAllOperation: Promise<void> | null = null

  const closeEntry = (
    threadId: string,
    entry: JingleCheckpointerEntry<TCheckpointer>
  ): Promise<void> => {
    if (entry.closeOperation) {
      return entry.closeOperation
    }

    let shouldRemoveEntry = false
    const operation = (async () => {
      try {
        let checkpointer: TCheckpointer
        try {
          checkpointer = await entry.creation
        } catch {
          shouldRemoveEntry = true
          return
        }

        await checkpointer.close()
        shouldRemoveEntry = true
      } finally {
        if (shouldRemoveEntry && entries.get(threadId) === entry) {
          entries.delete(threadId)
        }
        if (entries.get(threadId) === entry) {
          entry.closeOperation = null
        }
      }
    })()
    entry.closeOperation = operation
    return operation
  }

  const getCheckpointer = async (threadId: string): Promise<TCheckpointer> => {
    while (true) {
      const activeCloseAll = closeAllOperation
      if (activeCloseAll) {
        await activeCloseAll
        continue
      }

      let entry = entries.get(threadId)
      if (entry?.closeOperation) {
        await entry.closeOperation
        continue
      }

      if (!entry) {
        entry = {
          closeOperation: null,
          creation: Promise.resolve().then(() => input.createCheckpointer())
        }
        entries.set(threadId, entry)
      }

      try {
        const checkpointer = await entry.creation
        if (entry.closeOperation) {
          await entry.closeOperation
          throw new Error(
            `[JingleCheckpointerManager] Checkpointer for thread "${threadId}" was closed during creation.`
          )
        }
        return checkpointer
      } catch (error) {
        if (entries.get(threadId) === entry && !entry.closeOperation) {
          entries.delete(threadId)
        }
        throw error
      }
    }
  }

  return {
    get: getCheckpointer,

    async close(threadId) {
      const activeCloseAll = closeAllOperation
      if (activeCloseAll) {
        await activeCloseAll
        return
      }

      const entry = entries.get(threadId)
      if (entry) {
        await closeEntry(threadId, entry)
      }
    },

    async closeAll() {
      if (closeAllOperation) {
        await closeAllOperation
        return
      }

      const operation = (async () => {
        const closing = Array.from(entries, ([threadId, entry]) => closeEntry(threadId, entry))
        const results = await Promise.allSettled(closing)
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        )
        if (errors.length > 0) {
          throw new AggregateError(errors, "Failed to close all Jingle runtime checkpointers.")
        }

        for (const flush of input.flushOnCloseAll ?? []) {
          await flush()
        }
      })()
      closeAllOperation = operation
      try {
        await operation
      } finally {
        if (closeAllOperation === operation) {
          closeAllOperation = null
        }
      }
    }
  }
}
