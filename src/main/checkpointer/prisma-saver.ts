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

type StringVersionCheckpoint = Checkpoint & {
  channel_versions: Record<string, string>
  versions_seen: Record<string, Record<string, string>>
}

type PendingMessagesRef = {
  __openworkRef: "checkpoint-channel"
  channel: "messages"
}

const PREGEL_TASKS_CHANNEL = "__pregel_tasks"
const MESSAGES_CHANNEL = "messages"
const OPENWORK_PENDING_MESSAGES_REF: PendingMessagesRef = {
  __openworkRef: "checkpoint-channel",
  channel: MESSAGES_CHANNEL
}

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.length > 0 ? field : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isPendingMessagesRef(value: unknown): value is PendingMessagesRef {
  return (
    isRecord(value) &&
    value.__openworkRef === OPENWORK_PENDING_MESSAGES_REF.__openworkRef &&
    value.channel === OPENWORK_PENDING_MESSAGES_REF.channel
  )
}

function normalizePregelTaskMessages(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  const args = value.args
  if (!isRecord(args) || !Object.prototype.hasOwnProperty.call(args, "messages")) {
    return value
  }

  return {
    ...value,
    args: {
      ...args,
      messages: OPENWORK_PENDING_MESSAGES_REF
    }
  }
}

function restorePregelTaskMessages(value: unknown, messages: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  const args = value.args
  if (!isRecord(args) || !isPendingMessagesRef(args.messages)) {
    return value
  }

  return {
    ...value,
    args: {
      ...args,
      messages
    }
  }
}

function hasPregelTaskMessagesRef(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const args = value.args
  return isRecord(args) && isPendingMessagesRef(args.messages)
}

function getRunIdForStorage(config: RunnableConfig, metadata?: CheckpointMetadata): string | null {
  return (
    readStringField(config.configurable, "run_id") ??
    readStringField(config.metadata, "run_id") ??
    readStringField(metadata, "run_id")
  )
}

function copyCheckpointManifest(checkpoint: Checkpoint): Omit<Checkpoint, "channel_values"> {
  const manifest = {
    ...checkpoint
  } as Partial<Checkpoint>
  delete manifest.channel_values
  return manifest as Omit<Checkpoint, "channel_values">
}

function ensureCheckpointChannelVersions(
  checkpoint: Checkpoint,
  newVersions: ChannelVersions
): ChannelVersions {
  const normalizedNewVersions = {
    ...newVersions
  }

  for (const channel of Object.keys(checkpoint.channel_values)) {
    if (checkpoint.channel_versions[channel] !== undefined) {
      continue
    }

    const version = normalizedNewVersions[channel] ?? checkpoint.id
    checkpoint.channel_versions[channel] = version
    normalizedNewVersions[channel] = version
  }

  return normalizedNewVersions
}

function assertStringChannelVersions(
  owner: string,
  versions: Record<string, string | number>
): asserts versions is Record<string, string> {
  for (const [channel, version] of Object.entries(versions)) {
    if (typeof version !== "string") {
      throw new Error(
        `[PrismaCheckpointSaver] ${owner} channel "${channel}" has non-string version "${String(version)}". Clear the stale checkpoint state and rerun.`
      )
    }
  }
}

function assertStringCheckpointVersions(
  checkpoint: Checkpoint
): asserts checkpoint is StringVersionCheckpoint {
  assertStringChannelVersions("checkpoint", checkpoint.channel_versions)

  for (const [node, versions] of Object.entries(checkpoint.versions_seen)) {
    assertStringChannelVersions(`versions_seen.${node}`, versions)
  }
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
  assertStringChannelVersions("stored checkpoint", channelVersions)
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
    const { thread_id, checkpoint_ns = "", checkpoint_id, run_id } = config.configurable ?? {}
    const isRunScopedRead = typeof run_id === "string"

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
            runId: isRunScopedRead ? run_id : undefined
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
    const run_id = config.configurable?.run_id
    const isRunScopedRead = typeof run_id === "string"

    if (!thread_id) {
      return
    }

    const rows = await prisma.checkpoint.findMany({
      where: {
        threadId: thread_id,
        checkpointNs: checkpoint_ns,
        runId: isRunScopedRead ? run_id : undefined,
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
      const metadataPayload = decodeSerializedPayload(row.type, row.metadata)
      const checkpoint = await this.loadCheckpoint(row)

      yield {
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
      ensureCheckpointChannelVersions(preparedCheckpoint, newVersions)
      assertStringCheckpointVersions(preparedCheckpoint)
      const checkpointManifest = copyCheckpointManifest(preparedCheckpoint)

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

        for (const blob of valueBlobs) {
          await tx.checkpointBlob.upsert({
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
        }

        for (const blob of emptyBlobs) {
          await tx.checkpointBlob.upsert({
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
        }

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

      const operations: Prisma.PrismaPromise<unknown>[] = []
      for (let idx = 0; idx < writes.length; idx += 1) {
        const write = writes[idx]
        const writeIndex = WRITES_IDX_MAP[write[0]] ?? idx
        const writeValue =
          write[0] === PREGEL_TASKS_CHANNEL ? normalizePregelTaskMessages(write[1]) : write[1]
        const [type, serializedValue] = await this.serde.dumpsTyped(writeValue)
        const [storedType, storedValue] = encodeSerializedPayload(type, serializedValue)

        operations.push(
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
      }

      if (operations.length > 0) {
        await prisma.$transaction(operations)
      }
    })
  }

  async deleteThread(threadId: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM "messages_fts" WHERE thread_id = ?`, threadId)
        await tx.$executeRawUnsafe(
          `DELETE FROM "messages_fts_trigram" WHERE thread_id = ?`,
          threadId
        )
        await tx.message.deleteMany({
          where: { threadId }
        })
        await tx.messageEvent.deleteMany({
          where: { threadId }
        })
        await tx.messageStateVersion.deleteMany({
          where: { threadId }
        })
        await tx.checkpointBlob.deleteMany({
          where: { threadId }
        })
        await tx.checkpointWrite.deleteMany({
          where: { threadId }
        })
        await tx.checkpoint.deleteMany({
          where: { threadId }
        })
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
    const blobs: CheckpointBlobRow[] = []
    for (const [channel, version] of Object.entries(versions)) {
      if (channel === MESSAGES_CHANNEL) {
        continue
      }

      if (channel in values) {
        const [type, serializedValue] = await this.serde.dumpsTyped(values[channel])
        const [storedType, storedValue] = encodeSerializedPayload(type, serializedValue)
        blobs.push({
          channel,
          checkpointNs,
          threadId,
          type: storedType,
          value: storedValue,
          version
        })
        continue
      }

      blobs.push({
        channel,
        checkpointNs,
        threadId,
        type: "empty",
        value: null,
        version
      })
    }

    return blobs
  }

  private async loadCheckpoint(row: CheckpointRow): Promise<Checkpoint> {
    const checkpointPayload = decodeSerializedPayload(row.type, row.checkpoint)
    const checkpoint = (await this.serde.loadsTyped(
      checkpointPayload.type,
      checkpointPayload.value
    )) as Checkpoint

    if (checkpoint.channel_values && typeof checkpoint.channel_values === "object") {
      assertStringCheckpointVersions(checkpoint)
      return checkpoint
    }

    assertStringCheckpointVersions(checkpoint)

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
    const values: Record<string, unknown> = {}

    for (const [channel, version] of entries) {
      if (channel === MESSAGES_CHANNEL) {
        values[channel] = await loadMessagesForStateVersion({
          checkpointNs,
          serde: this.serde,
          threadId,
          version
        })
        continue
      }

      const row = rowByKey.get(`${channel}\0${version}`)
      if (!row) {
        throw new Error(
          `[PrismaCheckpointSaver] Missing checkpoint blob for thread "${threadId}", namespace "${checkpointNs}", channel "${channel}", version "${version}".`
        )
      }

      if (row.type === "empty") {
        continue
      }

      const payload = decodeSerializedPayload(row.type, row.value)
      values[channel] = await this.serde.loadsTyped(payload.type, payload.value)
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

    const pendingWrites: [string, string, unknown][] = []

    for (const row of rows) {
      const payload = decodeSerializedPayload(row.type, row.value)
      const rawValue = await this.serde.loadsTyped(payload.type, payload.value)
      const value =
        row.channel === PREGEL_TASKS_CHANNEL && hasPregelTaskMessagesRef(rawValue)
          ? restorePregelTaskMessages(
              rawValue,
              await this.loadChannelValue(threadId, checkpointNs, "messages", checkpointId)
            )
          : rawValue
      pendingWrites.push([row.taskId, row.channel, value])
    }

    return pendingWrites
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
