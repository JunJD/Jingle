import type { RunnableConfig } from "@langchain/core/runnables"
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol
} from "@langchain/langgraph-checkpoint"
import { syncMessagesFromSnapshot, upsertHitlRequest } from "../db"
import { getPrismaClient } from "../db/client"
import {
  extractHitlRequestFromCheckpoint,
  extractMessagesFromCheckpoint
} from "../agent/runtime-state"
import { decodeSerializedPayload, encodeSerializedPayload } from "./storage-codec"

export class PrismaCheckpointSaver extends BaseCheckpointSaver {
  constructor(serde?: SerializerProtocol) {
    super(serde)
  }

  async initialize(): Promise<void> {
    return
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const prisma = getPrismaClient()
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {}

    if (!thread_id) {
      return undefined
    }

    const row = checkpoint_id
      ? await prisma.checkpoint.findUnique({
          where: {
            threadId_checkpointNs_checkpointId: {
              threadId: thread_id,
              checkpointNs: checkpoint_ns,
              checkpointId: checkpoint_id
            }
          }
        })
      : await prisma.checkpoint.findFirst({
          where: {
            threadId: thread_id,
            checkpointNs: checkpoint_ns
          },
          orderBy: {
            checkpointId: "desc"
          }
        })

    if (!row || !row.checkpoint || !row.metadata) {
      return undefined
    }

    const pendingWrites = await this.loadPendingWrites(
      row.threadId,
      row.checkpointNs,
      row.checkpointId
    )
    const checkpointPayload = decodeSerializedPayload(row.type, row.checkpoint)
    const metadataPayload = decodeSerializedPayload(row.type, row.metadata)
    const checkpoint = (await this.serde.loadsTyped(
      checkpointPayload.type,
      checkpointPayload.value
    )) as Checkpoint

    return {
      checkpoint,
      config: checkpoint_id
        ? config
        : {
            configurable: {
              thread_id: row.threadId,
              checkpoint_ns: row.checkpointNs,
              checkpoint_id: row.checkpointId
            }
          },
      metadata: (await this.serde.loadsTyped(
        metadataPayload.type,
        metadataPayload.value
      )) as CheckpointMetadata,
      parentConfig: row.parentCheckpointId
        ? {
            configurable: {
              thread_id: row.threadId,
              checkpoint_ns: row.checkpointNs,
              checkpoint_id: row.parentCheckpointId
            }
          }
        : undefined,
      pendingWrites
    }
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const prisma = getPrismaClient()
    const { limit, before } = options ?? {}
    const thread_id = config.configurable?.thread_id
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? ""

    if (!thread_id) {
      return
    }

    const rows = await prisma.checkpoint.findMany({
      where: {
        threadId: thread_id,
        checkpointNs: checkpoint_ns,
        checkpointId: before?.configurable?.checkpoint_id
          ? {
              lt: before.configurable.checkpoint_id
            }
          : undefined
      },
      orderBy: {
        checkpointId: "desc"
      },
      take: limit
    })

    for (const row of rows) {
      if (!row.checkpoint || !row.metadata) {
        continue
      }

      const pendingWrites = await this.loadPendingWrites(
        row.threadId,
        row.checkpointNs,
        row.checkpointId
      )
      const checkpointPayload = decodeSerializedPayload(row.type, row.checkpoint)
      const metadataPayload = decodeSerializedPayload(row.type, row.metadata)
      const checkpoint = (await this.serde.loadsTyped(
        checkpointPayload.type,
        checkpointPayload.value
      )) as Checkpoint

      yield {
        config: {
          configurable: {
            thread_id: row.threadId,
            checkpoint_ns: row.checkpointNs,
            checkpoint_id: row.checkpointId
          }
        },
        checkpoint,
        metadata: (await this.serde.loadsTyped(
          metadataPayload.type,
          metadataPayload.value
        )) as CheckpointMetadata,
        parentConfig: row.parentCheckpointId
          ? {
              configurable: {
                thread_id: row.threadId,
                checkpoint_ns: row.checkpointNs,
                checkpoint_id: row.parentCheckpointId
              }
            }
          : undefined,
        pendingWrites
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const prisma = getPrismaClient()

    if (!config.configurable?.thread_id) {
      throw new Error('Missing "thread_id" field in passed "config.configurable".')
    }

    const threadId = config.configurable.thread_id
    const runId = typeof config.configurable.run_id === "string" ? config.configurable.run_id : null
    const checkpointNs = config.configurable.checkpoint_ns ?? ""
    const parentCheckpointId = config.configurable.checkpoint_id
    const preparedCheckpoint = copyCheckpoint(checkpoint)

    const [[type, serializedCheckpoint], [metadataType, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata)
    ])

    if (type !== metadataType) {
      throw new Error("Failed to serialize checkpoint and metadata to the same type.")
    }

    const [storedType, storedCheckpoint] = encodeSerializedPayload(type, serializedCheckpoint)
    const [, storedMetadata] = encodeSerializedPayload(metadataType, serializedMetadata)

    await prisma.checkpoint.upsert({
      where: {
        threadId_checkpointNs_checkpointId: {
          threadId,
          checkpointNs,
          checkpointId: checkpoint.id
        }
      },
      create: {
        threadId,
        checkpointNs,
        checkpointId: checkpoint.id,
        parentCheckpointId: parentCheckpointId ?? null,
        type: storedType,
        checkpoint: storedCheckpoint,
        metadata: storedMetadata
      },
      update: {
        parentCheckpointId: parentCheckpointId ?? null,
        type: storedType,
        checkpoint: storedCheckpoint,
        metadata: storedMetadata
      }
    })

    const tuple = {
      checkpoint: preparedCheckpoint,
      metadata
    } as CheckpointTuple
    const messages = extractMessagesFromCheckpoint(threadId, tuple)
    if (messages.length > 0) {
      await syncMessagesFromSnapshot(threadId, runId, messages)
    }

    const hitlRequest = extractHitlRequestFromCheckpoint(threadId, tuple, { runId })
    if (hitlRequest) {
      await upsertHitlRequest({
        request_id: hitlRequest.id,
        thread_id: threadId,
        run_id: runId,
        tool_call_id: hitlRequest.tool_call.id || null,
        tool_name: hitlRequest.tool_call.name,
        tool_args: hitlRequest.tool_call.args,
        allowed_decisions: hitlRequest.allowed_decisions,
        status: "pending"
      })
    }

    return {
      configurable: {
        ...config.configurable,
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id
      }
    }
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const prisma = getPrismaClient()

    if (!config.configurable?.thread_id) {
      throw new Error("Missing thread_id field in config.configurable.")
    }

    if (!config.configurable?.checkpoint_id) {
      throw new Error("Missing checkpoint_id field in config.configurable.")
    }

    const threadId = config.configurable.thread_id
    const checkpointNs = config.configurable.checkpoint_ns ?? ""
    const checkpointId = config.configurable.checkpoint_id

    for (let idx = 0; idx < writes.length; idx += 1) {
      const write = writes[idx]
      const [type, serializedValue] = await this.serde.dumpsTyped(write[1])
      const [storedType, storedValue] = encodeSerializedPayload(type, serializedValue)

      await prisma.checkpointWrite.upsert({
        where: {
          threadId_checkpointNs_checkpointId_taskId_idx: {
            threadId,
            checkpointNs,
            checkpointId,
            taskId,
            idx
          }
        },
        create: {
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          idx,
          channel: write[0],
          type: storedType,
          value: storedValue
        },
        update: {
          channel: write[0],
          type: storedType,
          value: storedValue
        }
      })
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const prisma = getPrismaClient()

    await prisma.$transaction([
      prisma.checkpointWrite.deleteMany({
        where: { threadId }
      }),
      prisma.checkpoint.deleteMany({
        where: { threadId }
      })
    ])
  }

  async close(): Promise<void> {
    return
  }

  private async loadPendingWrites(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): Promise<[string, string, unknown][]> {
    const prisma = getPrismaClient()
    const rows = await prisma.checkpointWrite.findMany({
      where: {
        threadId,
        checkpointNs,
        checkpointId
      },
      orderBy: [{ taskId: "asc" }, { idx: "asc" }]
    })

    const pendingWrites: [string, string, unknown][] = []

    for (const row of rows) {
      const payload = decodeSerializedPayload(row.type, row.value)
      const value = await this.serde.loadsTyped(payload.type, payload.value)
      pendingWrites.push([row.taskId, row.channel, value])
    }

    return pendingWrites
  }
}
