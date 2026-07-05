import type { AgentThreadDataSnapshot } from "../types"

interface PersistedAgentThreadDataReader {
  getPersistedAgentThreadData(threadId: string): Promise<AgentThreadDataSnapshot>
}

interface LiveAgentThreadDataSnapshotReader {
  readLiveThreadDataSnapshot(
    threadId: string,
    persistedThreadData: AgentThreadDataSnapshot
  ): AgentThreadDataSnapshot | null
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

    return liveThreadData ?? persistedThreadData
  }
}
