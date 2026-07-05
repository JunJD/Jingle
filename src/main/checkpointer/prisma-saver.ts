import type { RunnableConfig } from "@langchain/core/runnables"
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
  WRITES_IDX_MAP,
  uuid6
} from "@langchain/langgraph-checkpoint"
import {
  assertJingleStringChannelVersions,
  assertJingleStringCheckpointVersions,
  copyJingleCheckpointManifest,
  ensureJingleCheckpointChannelVersions,
  hasJinglePregelTaskMessagesRef,
  JINGLE_LANGGRAPH_MESSAGES_CHANNEL,
  JINGLE_LANGGRAPH_PREGEL_TASKS_CHANNEL,
  normalizeJinglePregelTaskMessages,
  restoreJinglePregelTaskMessages
} from "@jingle/langchain-agent-harness/transitional"
import type { Prisma } from "@prisma/client"
import { getPrismaClient } from "../db/client"
import {
  loadMessagesForStateVersion,
  persistMessageStateVersion,
  prepareMessageStateItems
} from "../db/message-state"
import { decodeSerializedPayload, encodeSerializedPayload } from "./storage-codec"

type CheckpointRow = {
  checkpoint: string | null
  checkpointId: string
  checkpointNs: string
  metadata: string | null
  parentCheckpointId: string | null
  runId: string | null
  threadId: string
  type: string | null
}

type CheckpointBlobRow = {
  channel: string
  checkpointNs: string
  threadId: string
  type: string | null
  value: string | null
  version: string
}

const PREGEL_TASKS_CHANNEL = JINGLE_LANGGRAPH_PREGEL_TASKS_CHANNEL
const MESSAGES_CHANNEL = JINGLE_LANGGRAPH_MESSAGES_CHANNEL

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.length > 0 ? field : null
}

function getRunIdForStorage(config: RunnableConfig, metadata?: CheckpointMetadata): string | null {
  return (
    readStringField(config.configurable, "run_id") ??
    readStringField(config.metadata, "run_id") ??
    readStringField(metadata, "run_id")
  )
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined
}

export function readStoredCheckpointChannelVersions(
  storedType: string | null,
  storedCheckpoint: string | null
): Record<string, string> | null {
  if (!storedCheckpoint) {
    return null
  }

  const payload = decodeSerializedPayload(storedType, storedCheckpoint)
  const decoded =
    typeof payload.value === "string" ? payload.value : Buffer.from(payload.value).toString("utf8")
  const checkpoint = JSON.parse(decoded) as {
    channel_values?: unknown
    channel_versions?: Record<string, string | number>
  }

  if (checkpoint.channel_values) {
    return null
  }

  const channelVersions = checkpoint.channel_versions ?? {}
  assertJingleStringChannelVersions("stored checkpoint", channelVersions)
  return channelVersions
}

export class PrismaCheckpointSaver extends BaseCheckpointSaver<string> {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(serde?: SerializerProtocol) {
    super(serde)
  }

  async initialize(): Promise<void> {
    return
  }

  override getNextVersion(_current: string | undefined): string {
    return uuid6(-2)
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const prisma = getPrismaClient()
    const { thread_id, checkpoint_ns = "", checkpoint_id, checkpoint_run_id } =
      config.configurable ?? {}
    const isRunScopedRead = typeof checkpoint_run_id === "string"

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
            checkpointNs: checkpoint_ns,
            runId: isRunScopedRead ? checkpoint_run_id : undefined
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
    const metadataPayload = decodeSerializedPayload(row.type, row.metadata)
    const checkpoint = await this.loadCheckpoint(row)

    return {
      checkpoint,
      config: {
        configurable: {
          thread_id: row.threadId,
          checkpoint_ns: row.checkpointNs,
          checkpoint_id: row.checkpointId,
          ...(isRunScopedRead && row.runId ? { run_id: row.runId } : {})
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
    const checkpoint_run_id = config.configurable?.checkpoint_run_id
    const isRunScopedRead = typeof checkpoint_run_id === "string"

    if (!thread_id) {
      return
    }

    const rows = await prisma.checkpoint.findMany({
      where: {
        threadId: thread_id,
        checkpointNs: checkpoint_ns,
        runId: isRunScopedRead ? checkpoint_run_id : undefined,
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

    const tuples = await Promise.all(
      rows.map(async (row) => {
        if (!row.checkpoint || !row.metadata) {
          return undefined
        }

        const pendingWrites = await this.loadPendingWrites(
          row.threadId,
          row.checkpointNs,
          row.checkpointId
        )
        const metadataPayload = decodeSerializedPayload(row.type, row.metadata)
        const checkpoint = await this.loadCheckpoint(row)

        return {
          config: {
            configurable: {
              thread_id: row.threadId,
              checkpoint_ns: row.checkpointNs,
              checkpoint_id: row.checkpointId,
              ...(isRunScopedRead && row.runId ? { run_id: row.runId } : {})
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
      })
    )

    for (const tuple of tuples) {
      if (tuple) {
        yield tuple
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions = checkpoint.channel_versions
  ): Promise<RunnableConfig> {
    return this.enqueueWrite(async () => {
      const prisma = getPrismaClient()

      if (!config.configurable?.thread_id) {
        throw new Error('Missing "thread_id" field in passed "config.configurable".')
      }

      const threadId = config.configurable.thread_id
      const runId = getRunIdForStorage(config, metadata)
      const checkpointNs = config.configurable.checkpoint_ns ?? ""
      const parentCheckpointId = config.configurable.checkpoint_id
      const preparedCheckpoint = copyCheckpoint(checkpoint)
      ensureJingleCheckpointChannelVersions(preparedCheckpoint, newVersions)
      assertJingleStringCheckpointVersions(preparedCheckpoint)
      const checkpointManifest = copyJingleCheckpointManifest(preparedCheckpoint)

      const messages = preparedCheckpoint.channel_values[MESSAGES_CHANNEL]
      const messagesVersion = preparedCheckpoint.channel_versions[MESSAGES_CHANNEL]
      if (messages !== undefined && !Array.isArray(messages)) {
        throw new Error(
          `[PrismaCheckpointSaver] Checkpoint "${checkpoint.id}" has a non-array messages channel value.`
        )
      }
      if (messages !== undefined && !messagesVersion) {
        throw new Error(
          `[PrismaCheckpointSaver] Checkpoint "${checkpoint.id}" has messages channel value without a messages channel version.`
        )
      }
      const preparedMessages = Array.isArray(messages)
        ? await prepareMessageStateItems({
            messages,
            serde: this.serde
          })
        : undefined

      const [[type, serializedCheckpoint], [metadataType, serializedMetadata], serializedBlobs] =
        await Promise.all([
          this.serde.dumpsTyped(checkpointManifest),
          this.serde.dumpsTyped(metadata),
          this.dumpChannelBlobs(
            threadId,
            checkpointNs,
            preparedCheckpoint.channel_values,
            preparedCheckpoint.channel_versions
          )
        ])

      if (type !== metadataType) {
        throw new Error("Failed to serialize checkpoint and metadata to the same type.")
      }

      const [storedType, storedCheckpoint] = encodeSerializedPayload(type, serializedCheckpoint)
      const [, storedMetadata] = encodeSerializedPayload(metadataType, serializedMetadata)

      const valueBlobs = serializedBlobs.filter((blob) => blob.type !== "empty")
      const emptyBlobs = serializedBlobs.filter((blob) => blob.type === "empty")

      await prisma.$transaction(async (tx) => {
        if (messagesVersion) {
          await persistMessageStateVersion(
            {
              checkpointId: checkpoint.id,
              checkpointNs,
              messages: preparedMessages,
              runId,
              threadId,
              version: messagesVersion
            },
            tx
          )
        }

        await Promise.all([
          ...valueBlobs.map((blob) =>
            tx.checkpointBlob.upsert({
              where: {
                threadId_checkpointNs_channel_version: {
                  channel: blob.channel,
                  checkpointNs,
                  threadId,
                  version: blob.version
                }
              },
              create: blob,
              update: {
                type: blob.type,
                value: blob.value
              }
            })
          ),
          ...emptyBlobs.map((blob) =>
            tx.checkpointBlob.upsert({
              where: {
                threadId_checkpointNs_channel_version: {
                  channel: blob.channel,
                  checkpointNs,
                  threadId,
                  version: blob.version
                }
              },
              create: blob,
              update: {}
            })
          )
        ])

        await tx.checkpoint.upsert({
          where: {
            threadId_checkpointNs_checkpointId: {
              threadId,
              checkpointNs,
              checkpointId: checkpoint.id
            }
          },
          create: {
            threadId,
            runId,
            checkpointNs,
            checkpointId: checkpoint.id,
            parentCheckpointId: parentCheckpointId ?? null,
            type: storedType,
            checkpoint: storedCheckpoint,
            metadata: storedMetadata
          },
          update: {
            runId,
            parentCheckpointId: parentCheckpointId ?? null,
            type: storedType,
            checkpoint: storedCheckpoint,
            metadata: storedMetadata
          }
        })
      })
      await this.afterPut({
        checkpoint: preparedCheckpoint,
        checkpointNs,
        metadata,
        runId,
        threadId
      })

      return {
        configurable: {
          ...config.configurable,
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpoint.id
        }
      }
    })
  }

  protected async afterPut(input: {
    checkpoint: Checkpoint
    checkpointNs: string
    metadata: CheckpointMetadata
    runId: string | null
    threadId: string
  }): Promise<void> {
    void input
    return
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    return this.enqueueWrite(async () => {
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

      const preparedWrites = await Promise.all(
        writes.map(async (write, idx) => {
          const writeIndex = WRITES_IDX_MAP[write[0]] ?? idx
          const writeValue =
            write[0] === PREGEL_TASKS_CHANNEL
              ? normalizeJinglePregelTaskMessages(write[1])
              : write[1]
          const [type, serializedValue] = await this.serde.dumpsTyped(writeValue)
          const [storedType, storedValue] = encodeSerializedPayload(type, serializedValue)

          return { storedType, storedValue, write, writeIndex }
        })
      )

      const operations: Prisma.PrismaPromise<unknown>[] = preparedWrites.map(
        ({ storedType, storedValue, write, writeIndex }) =>
          prisma.checkpointWrite.upsert({
            where: {
              threadId_checkpointNs_checkpointId_taskId_idx: {
                threadId,
                checkpointNs,
                checkpointId,
                taskId,
                idx: writeIndex
              }
            },
            create: {
              threadId,
              checkpointNs,
              checkpointId,
              taskId,
              idx: writeIndex,
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
      )

      if (operations.length > 0) {
        await prisma.$transaction(operations)
      }
    })
  }

  async deleteThread(threadId: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        await Promise.all([
          tx.$executeRaw`DELETE FROM "messages_fts" WHERE thread_id = ${threadId}`,
          tx.$executeRaw`DELETE FROM "messages_fts_trigram" WHERE thread_id = ${threadId}`,
          tx.message.deleteMany({
            where: { threadId }
          }),
          tx.messageEvent.deleteMany({
            where: { threadId }
          }),
          tx.messageStateVersion.deleteMany({
            where: { threadId }
          }),
          tx.checkpointBlob.deleteMany({
            where: { threadId }
          }),
          tx.checkpointWrite.deleteMany({
            where: { threadId }
          }),
          tx.checkpoint.deleteMany({
            where: { threadId }
          })
        ])
      })
    })
  }

  async close(): Promise<void> {
    await this.writeQueue
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation)
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async dumpChannelBlobs(
    threadId: string,
    checkpointNs: string,
    values: Record<string, unknown>,
    versions: Record<string, string>
  ): Promise<CheckpointBlobRow[]> {
    const blobs = await Promise.all(
      Object.entries(versions).map(async ([channel, version]) => {
        if (channel === MESSAGES_CHANNEL) {
          return undefined
        }

        if (channel in values) {
          const [type, serializedValue] = await this.serde.dumpsTyped(values[channel])
          const [storedType, storedValue] = encodeSerializedPayload(type, serializedValue)
          return {
            channel,
            checkpointNs,
            threadId,
            type: storedType,
            value: storedValue,
            version
          }
        }

        return {
          channel,
          checkpointNs,
          threadId,
          type: "empty",
          value: null,
          version
        }
      })
    )

    return blobs.filter(isPresent)
  }

  private async loadCheckpoint(row: CheckpointRow): Promise<Checkpoint> {
    const checkpointPayload = decodeSerializedPayload(row.type, row.checkpoint)
    const checkpoint = (await this.serde.loadsTyped(
      checkpointPayload.type,
      checkpointPayload.value
    )) as Checkpoint

    if (checkpoint.channel_values && typeof checkpoint.channel_values === "object") {
      assertJingleStringCheckpointVersions(checkpoint)
      return checkpoint
    }

    assertJingleStringCheckpointVersions(checkpoint)

    return {
      ...checkpoint,
      channel_values: await this.loadChannelValues(
        row.threadId,
        row.checkpointNs,
        checkpoint.channel_versions
      )
    }
  }

  private async loadChannelValues(
    threadId: string,
    checkpointNs: string,
    channelVersions: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const entries = Object.entries(channelVersions)
    if (entries.length === 0) {
      return {}
    }

    const prisma = getPrismaClient()
    const blobEntries = entries.filter(([channel]) => channel !== MESSAGES_CHANNEL)
    const rows =
      blobEntries.length === 0
        ? []
        : await prisma.checkpointBlob.findMany({
            where: {
              OR: blobEntries.map(([channel, version]) => ({
                channel,
                version
              })),
              checkpointNs,
              threadId
            }
          })
    const rowByKey = new Map(rows.map((row) => [`${row.channel}\0${row.version}`, row]))
    const loadedValues = await Promise.all(
      entries.map(async ([channel, version]) => {
        if (channel === MESSAGES_CHANNEL) {
          const value = await loadMessagesForStateVersion({
            checkpointNs,
            serde: this.serde,
            threadId,
            version
          })
          return [channel, value] as const
        }

        const row = rowByKey.get(`${channel}\0${version}`)
        if (!row) {
          throw new Error(
            `[PrismaCheckpointSaver] Missing checkpoint blob for thread "${threadId}", namespace "${checkpointNs}", channel "${channel}", version "${version}".`
          )
        }

        if (row.type === "empty") {
          return undefined
        }

        const payload = decodeSerializedPayload(row.type, row.value)
        const value = await this.serde.loadsTyped(payload.type, payload.value)
        return [channel, value] as const
      })
    )

    const values: Record<string, unknown> = {}
    for (const loadedValue of loadedValues) {
      if (loadedValue) {
        values[loadedValue[0]] = loadedValue[1]
      }
    }

    return values
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

    let messagesValue: Promise<unknown> | undefined
    return Promise.all(
      rows.map(async (row) => {
        const payload = decodeSerializedPayload(row.type, row.value)
        const rawValue = await this.serde.loadsTyped(payload.type, payload.value)
        const value =
          row.channel === PREGEL_TASKS_CHANNEL && hasJinglePregelTaskMessagesRef(rawValue)
            ? restoreJinglePregelTaskMessages(
                rawValue,
                await (messagesValue ??= this.loadChannelValue(
                  threadId,
                  checkpointNs,
                  "messages",
                  checkpointId
                ))
              )
            : rawValue
        return [row.taskId, row.channel, value] as [string, string, unknown]
      })
    )
  }

  private async loadChannelValue(
    threadId: string,
    checkpointNs: string,
    channel: string,
    checkpointId: string
  ): Promise<unknown> {
    const checkpointRow = await getPrismaClient().checkpoint.findUnique({
      where: {
        threadId_checkpointNs_checkpointId: {
          checkpointId,
          checkpointNs,
          threadId
        }
      }
    })
    if (!checkpointRow) {
      throw new Error(
        `[PrismaCheckpointSaver] Missing checkpoint "${checkpointId}" for pending write channel "${channel}".`
      )
    }

    const channelVersions = readStoredCheckpointChannelVersions(
      checkpointRow.type,
      checkpointRow.checkpoint
    )
    const version = channelVersions?.[channel]
    if (!version) {
      throw new Error(
        `[PrismaCheckpointSaver] Missing channel version for "${channel}" on checkpoint "${checkpointId}".`
      )
    }

    const values = await this.loadChannelValues(threadId, checkpointNs, {
      [channel]: version
    })
    if (!Object.prototype.hasOwnProperty.call(values, channel)) {
      throw new Error(
        `[PrismaCheckpointSaver] Missing channel value for "${channel}" on checkpoint "${checkpointId}".`
      )
    }

    return values[channel]
  }
}
