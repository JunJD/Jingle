import type { AgentThreadDataSnapshot } from "../types"
import type { Message } from "@shared/app-types"

interface PersistedAgentThreadDataReader {
  getPersistedAgentThreadData(threadId: string): Promise<AgentThreadDataSnapshot>
}

interface LiveAgentThreadDataSnapshotReader {
  readLiveThreadDataSnapshot(
    threadId: string,
    persistedThreadData: AgentThreadDataSnapshot
  ): AgentThreadDataSnapshot | null
}

function mergePersistedToolMessages(
  liveMessages: readonly Message[],
  persistedMessages: readonly Message[]
): Message[] {
  const liveMessageIds = new Set(liveMessages.map((message) => message.id))
  const missingToolMessages = persistedMessages.filter(
    (message) => message.role === "tool" && !liveMessageIds.has(message.id)
  )
  return missingToolMessages.length === 0
    ? [...liveMessages]
    : [...liveMessages, ...missingToolMessages]
}

export class AgentThreadDataSnapshotService {
  constructor(
    private readonly threadsService: PersistedAgentThreadDataReader,
    private readonly agentThreadRunner: LiveAgentThreadDataSnapshotReader
  ) {}

  async readAgentThreadDataSnapshot(threadId: string): Promise<AgentThreadDataSnapshot> {
    const persistedThreadData = await this.threadsService.getPersistedAgentThreadData(threadId)
    const liveThreadData = this.agentThreadRunner.readLiveThreadDataSnapshot(
      threadId,
      persistedThreadData
    )

    if (!liveThreadData) {
      return persistedThreadData
    }

    const messages = mergePersistedToolMessages(
      liveThreadData.messages.messages,
      persistedThreadData.messages.messages
    )
    return messages.length === liveThreadData.messages.messages.length
      ? liveThreadData
      : {
          ...liveThreadData,
          messages: {
            ...liveThreadData.messages,
            messages
          }
        }
  }
}
