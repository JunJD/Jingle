export interface JingleRuntimeCheckpointer {
  close(): Promise<void>
}

export interface CreateJingleCheckpointerManagerInput<TCheckpointer extends JingleRuntimeCheckpointer> {
  createCheckpointer(): Promise<TCheckpointer>
  flushOnCloseAll?: Array<() => Promise<void>>
}

export interface JingleCheckpointerManager<TCheckpointer extends JingleRuntimeCheckpointer> {
  close(threadId: string): Promise<void>
  closeAll(): Promise<void>
  get(threadId: string): Promise<TCheckpointer>
}

export function createJingleCheckpointerManager<TCheckpointer extends JingleRuntimeCheckpointer>(
  input: CreateJingleCheckpointerManagerInput<TCheckpointer>
): JingleCheckpointerManager<TCheckpointer> {
  const checkpointers = new Map<string, TCheckpointer>()

  return {
    async get(threadId) {
      let checkpointer = checkpointers.get(threadId)
      if (!checkpointer) {
        checkpointer = await input.createCheckpointer()
        checkpointers.set(threadId, checkpointer)
      }
      return checkpointer
    },

    async close(threadId) {
      const checkpointer = checkpointers.get(threadId)
      if (checkpointer) {
        await checkpointer.close()
        checkpointers.delete(threadId)
      }
    },

    async closeAll() {
      const closePromises = Array.from(checkpointers.values()).map((checkpointer) =>
        checkpointer.close()
      )
      await Promise.all(closePromises)

      for (const flush of input.flushOnCloseAll ?? []) {
        await flush()
      }

      checkpointers.clear()
    }
  }
}
