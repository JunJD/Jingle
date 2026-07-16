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
  assertRuntimeCompactRequestIdentity,
  JINGLE_LANGGRAPH_MESSAGES_CHANNEL,
  JINGLE_LANGGRAPH_PREGEL_TASKS_CHANNEL,
  normalizeJinglePregelTaskMessages,
  readRuntimeCompactionCommitMetadata,
  restoreJinglePregelTaskMessages
} from "@jingle/langchain-agent-harness/transitional"
import type {
  RuntimeCheckpointCompactionOwnedValues,
  RuntimeCheckpointCompactionReceipt,
  RuntimeCompactRequestIdentity
} from "@jingle/langchain-agent-harness/transitional"
import type { RuntimeCompaction } from "@jingle/langchain-agent-harness"
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

type RuntimeCompactionCommitRow = {
  checkpointId: string
  checkpointNs: string
  compaction: string
  expectedCheckpointId: string
  messageCountAfterCompaction: number
  messageCountBeforeCompaction: number
  modelId: string
  operationId: string
  preserveLastUserMessageCountPresent: bigint | boolean | number
  reason: string | null
  requestedPreserveLastUserMessageCount: bigint | number | null
  threadId: string
  trigger: string
}

export type PrismaCheckpointCompactionReceipt = RuntimeCheckpointCompactionReceipt

export interface PrismaCheckpointCompactionInput {
  checkpoint: Checkpoint
  checkpointNs: string
  commitMetadata: Record<string, unknown>
  commitMetadataKey: string
  expectedCheckpointId: string
  operationId: string
  ownedValues: RuntimeCheckpointCompactionOwnedValues
  requestIdentity: RuntimeCompactRequestIdentity
  result: {
    compaction: RuntimeCompaction
    messageCountAfterCompaction: number
    messageCountBeforeCompaction: number
  }
  threadId: string
}

export type PrismaCheckpointCompactionResult =
  | { actualCheckpointId: string | null; status: "conflict" }
  | {
      checkpoint: Checkpoint
      receipt: PrismaCheckpointCompactionReceipt
      runId: string | null
      status: "committed"
    }
  | { receipt: PrismaCheckpointCompactionReceipt; status: "already-committed" }
  | { status: "not-found" }
  | { checkpointId: string; reason: "pending-writes"; status: "unstable" }

const PREGEL_TASKS_CHANNEL = JINGLE_LANGGRAPH_PREGEL_TASKS_CHANNEL
const MESSAGES_CHANNEL = JINGLE_LANGGRAPH_MESSAGES_CHANNEL
const COMPACT_OWNED_CHANNELS = [
  "_summarizationEvent",
  "_summarizationSessionId",
  "compactions",
  MESSAGES_CHANNEL
] as const

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

function buildStoredCheckpointConfig(
  input: Pick<PrismaCheckpointCompactionInput, "checkpointNs" | "threadId">,
  checkpointId: string
): RunnableConfig {
  return {
    configurable: {
      checkpoint_id: checkpointId,
      checkpoint_ns: input.checkpointNs,
      thread_id: input.threadId
    }
  }
}

function mapRuntimeCompactionCommitRow(
  row: RuntimeCompactionCommitRow
): PrismaCheckpointCompactionReceipt {
  const compaction = parseRuntimeCompaction(row.compaction, row.operationId)
  const preserveLastUserMessageCountPresent = readStoredBoolean(
    row.preserveLastUserMessageCountPresent
  )
  const requestedPreserveLastUserMessageCount = readStoredSafeInteger(
    row.requestedPreserveLastUserMessageCount
  )
  if (
    typeof row.modelId !== "string" ||
    row.modelId.length === 0 ||
    row.modelId !== row.modelId.trim()
  ) {
    throw new Error(
      `[PrismaCheckpointSaver] Compact ledger operation "${row.operationId}" has an invalid model ID.`
    )
  }
  if (
    preserveLastUserMessageCountPresent === null ||
    (row.reason !== null && typeof row.reason !== "string") ||
    (row.requestedPreserveLastUserMessageCount !== null &&
      requestedPreserveLastUserMessageCount === null) ||
    (!preserveLastUserMessageCountPresent && requestedPreserveLastUserMessageCount !== null) ||
    row.trigger !== "manual"
  ) {
    throw new Error(
      `[PrismaCheckpointSaver] Compact ledger operation "${row.operationId}" has invalid request identity.`
    )
  }
  if (
    !Number.isSafeInteger(row.messageCountAfterCompaction) ||
    row.messageCountAfterCompaction < 0 ||
    !Number.isSafeInteger(row.messageCountBeforeCompaction) ||
    row.messageCountBeforeCompaction < 0
  ) {
    throw new Error(
      `[PrismaCheckpointSaver] Compact ledger operation "${row.operationId}" has invalid message counts.`
    )
  }

  return {
    checkpointConfig: buildStoredCheckpointConfig(row, row.checkpointId),
    compaction,
    expectedCheckpointId: row.expectedCheckpointId,
    messageCountAfterCompaction: row.messageCountAfterCompaction,
    messageCountBeforeCompaction: row.messageCountBeforeCompaction,
    modelId: row.modelId,
    operationId: row.operationId,
    preserveLastUserMessageCount: requestedPreserveLastUserMessageCount,
    preserveLastUserMessageCountPresent,
    reason: row.reason,
    trigger: "manual"
  }
}

function readStoredBoolean(value: bigint | boolean | number): boolean | null {
  if (value === false || value === true) return value
  if (value === 0 || value === 0n) return false
  if (value === 1 || value === 1n) return true
  return null
}

function readStoredSafeInteger(value: bigint | number | null): number | null {
  if (value === null) return null
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(value)
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null
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
    const {
      thread_id,
      checkpoint_ns = "",
      checkpoint_id,
      checkpoint_run_id
    } = config.configurable ?? {}
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

  async compactCheckpoint(
    input: PrismaCheckpointCompactionInput
  ): Promise<PrismaCheckpointCompactionResult> {
    return this.enqueueWrite(async () => {
      if (input.checkpoint.id !== input.expectedCheckpointId) {
        throw new Error(
          `[PrismaCheckpointSaver] Compaction envelope "${input.checkpoint.id}" does not match expected checkpoint "${input.expectedCheckpointId}".`
        )
      }
      assertCompactOwnedChannels(input.ownedValues)
      assertCompactResult(input)

      const preparedCheckpoint = copyCheckpoint(input.checkpoint)
      preparedCheckpoint.id = uuid6(-1)
      preparedCheckpoint.ts = new Date().toISOString()
      for (const [channel, value] of Object.entries(input.ownedValues)) {
        preparedCheckpoint.channel_values[channel] = value
        const currentVersion = preparedCheckpoint.channel_versions[channel]
        if (currentVersion !== undefined && typeof currentVersion !== "string") {
          throw new Error(
            `[PrismaCheckpointSaver] Compact channel "${channel}" has a non-string version.`
          )
        }
        preparedCheckpoint.channel_versions[channel] = this.getNextVersion(currentVersion)
      }
      assertJingleStringCheckpointVersions(preparedCheckpoint)
      const checkpointManifest = copyJingleCheckpointManifest(preparedCheckpoint)
      const messages = preparedCheckpoint.channel_values[MESSAGES_CHANNEL]
      const messagesVersion = preparedCheckpoint.channel_versions[MESSAGES_CHANNEL]
      if (!Array.isArray(messages) || !messagesVersion) {
        throw new Error(
          `[PrismaCheckpointSaver] Compact checkpoint "${preparedCheckpoint.id}" must own an array messages channel and version.`
        )
      }

      const preparedMessages = await prepareMessageStateItems({
        messages,
        serde: this.serde
      })
      const commitMetadataValue = readRuntimeCompactionCommitMetadata(
        input.commitMetadata as CheckpointMetadata
      )
      if (
        !commitMetadataValue ||
        commitMetadataValue.operationId !== input.operationId ||
        commitMetadataValue.expectedCheckpointId !== input.expectedCheckpointId
      ) {
        throw new Error("[PrismaCheckpointSaver] Compact commit metadata is invalid.")
      }
      assertRuntimeCompactRequestIdentity(
        commitMetadataValue,
        input.requestIdentity,
        input.operationId
      )
      const nextMetadata = { ...input.commitMetadata } as CheckpointMetadata
      const [[type, serializedCheckpoint], [metadataType, serializedMetadata], serializedBlobs] =
        await Promise.all([
          this.serde.dumpsTyped(checkpointManifest),
          this.serde.dumpsTyped(nextMetadata),
          this.dumpChannelBlobs(
            input.threadId,
            input.checkpointNs,
            preparedCheckpoint.channel_values,
            preparedCheckpoint.channel_versions
          )
        ])
      if (type !== metadataType) {
        throw new Error("Failed to serialize compact checkpoint and metadata to the same type.")
      }

      const [storedType, storedCheckpoint] = encodeSerializedPayload(type, serializedCheckpoint)
      const [, storedMetadata] = encodeSerializedPayload(metadataType, serializedMetadata)
      const valueBlobs = serializedBlobs.filter((blob) => blob.type !== "empty")
      const emptyBlobs = serializedBlobs.filter((blob) => blob.type === "empty")
      const prisma = getPrismaClient()
      const transactionResult = await prisma.$transaction(async (tx) => {
        const existingCommits = await tx.$queryRaw<RuntimeCompactionCommitRow[]>`
          SELECT
            "thread_id" AS "threadId",
            "operation_id" AS "operationId",
            "checkpoint_ns" AS "checkpointNs",
            "checkpoint_id" AS "checkpointId",
            "expected_checkpoint_id" AS "expectedCheckpointId",
            "compaction",
            "message_count_after_compaction" AS "messageCountAfterCompaction",
            "message_count_before_compaction" AS "messageCountBeforeCompaction",
            "model_id" AS "modelId",
            "preserve_last_user_message_count_present" AS "preserveLastUserMessageCountPresent",
            "reason",
            "requested_preserve_last_user_message_count" AS "requestedPreserveLastUserMessageCount",
            "trigger"
          FROM "runtime_compaction_commits"
          WHERE "thread_id" = ${input.threadId}
            AND "operation_id" = ${input.operationId}
          LIMIT 1
        `
        const existingCommit = existingCommits[0]
        if (existingCommit) {
          const receipt = mapRuntimeCompactionCommitRow(existingCommit)
          assertRuntimeCompactRequestIdentity(receipt, input.requestIdentity, input.operationId)
          return {
            receipt,
            status: "already-committed"
          } as const
        }

        const latest = await tx.checkpoint.findFirst({
          where: {
            checkpointNs: input.checkpointNs,
            threadId: input.threadId
          },
          orderBy: { checkpointId: "desc" }
        })
        if (!latest) {
          return { status: "not-found" } as const
        }
        if (latest.checkpointId !== input.expectedCheckpointId) {
          return {
            actualCheckpointId: latest.checkpointId,
            status: "conflict"
          } as const
        }

        const pendingWriteCount = await tx.checkpointWrite.count({
          where: {
            checkpointId: input.expectedCheckpointId,
            checkpointNs: input.checkpointNs,
            threadId: input.threadId
          }
        })
        if (pendingWriteCount > 0) {
          return {
            checkpointId: input.expectedCheckpointId,
            reason: "pending-writes",
            status: "unstable"
          } as const
        }

        await persistMessageStateVersion(
          {
            checkpointId: preparedCheckpoint.id,
            checkpointNs: input.checkpointNs,
            messages: preparedMessages,
            runId: latest.runId,
            threadId: input.threadId,
            version: messagesVersion
          },
          tx
        )
        await Promise.all([
          ...valueBlobs.map((blob) =>
            tx.checkpointBlob.upsert({
              where: {
                threadId_checkpointNs_channel_version: {
                  channel: blob.channel,
                  checkpointNs: input.checkpointNs,
                  threadId: input.threadId,
                  version: blob.version
                }
              },
              create: blob,
              update: { type: blob.type, value: blob.value }
            })
          ),
          ...emptyBlobs.map((blob) =>
            tx.checkpointBlob.upsert({
              where: {
                threadId_checkpointNs_channel_version: {
                  channel: blob.channel,
                  checkpointNs: input.checkpointNs,
                  threadId: input.threadId,
                  version: blob.version
                }
              },
              create: blob,
              update: {}
            })
          )
        ])
        await tx.checkpoint.create({
          data: {
            checkpoint: storedCheckpoint,
            checkpointId: preparedCheckpoint.id,
            checkpointNs: input.checkpointNs,
            metadata: storedMetadata,
            parentCheckpointId: input.expectedCheckpointId,
            runId: latest.runId,
            threadId: input.threadId,
            type: storedType
          }
        })
        await tx.$executeRaw`
          INSERT INTO "runtime_compaction_commits" (
            "thread_id",
            "operation_id",
            "checkpoint_ns",
            "checkpoint_id",
            "expected_checkpoint_id",
            "compaction",
            "message_count_after_compaction",
            "message_count_before_compaction",
            "model_id",
            "preserve_last_user_message_count_present",
            "reason",
            "requested_preserve_last_user_message_count",
            "trigger"
          ) VALUES (
            ${input.threadId},
            ${input.operationId},
            ${input.checkpointNs},
            ${preparedCheckpoint.id},
            ${input.expectedCheckpointId},
            ${JSON.stringify(input.result.compaction)},
            ${input.result.messageCountAfterCompaction},
            ${input.result.messageCountBeforeCompaction},
            ${input.requestIdentity.modelId},
            ${input.requestIdentity.preserveLastUserMessageCountPresent},
            ${input.requestIdentity.reason},
            ${
              input.requestIdentity.preserveLastUserMessageCount === null
                ? null
                : BigInt(input.requestIdentity.preserveLastUserMessageCount)
            },
            ${input.requestIdentity.trigger}
          )
        `

        const receipt: PrismaCheckpointCompactionReceipt = {
          checkpointConfig: buildStoredCheckpointConfig(input, preparedCheckpoint.id),
          compaction: input.result.compaction,
          expectedCheckpointId: input.expectedCheckpointId,
          messageCountAfterCompaction: input.result.messageCountAfterCompaction,
          messageCountBeforeCompaction: input.result.messageCountBeforeCompaction,
          operationId: input.operationId,
          ...input.requestIdentity
        }

        return {
          checkpoint: preparedCheckpoint,
          receipt,
          runId: latest.runId,
          status: "committed"
        } as const
      })

      if (transactionResult.status === "committed") {
        void this.afterPut({
          checkpoint: transactionResult.checkpoint,
          checkpointNs: input.checkpointNs,
          metadata: nextMetadata,
          runId: transactionResult.runId,
          threadId: input.threadId
        }).catch(() => {
          console.error("[PrismaCheckpointSaver] Compact post-commit observation failed.", {
            checkpointId: transactionResult.checkpoint.id,
            threadId: input.threadId
          })
        })
        return {
          checkpoint: transactionResult.checkpoint,
          receipt: transactionResult.receipt,
          runId: transactionResult.runId,
          status: transactionResult.status
        }
      }

      return transactionResult
    })
  }

  async readCompactionCommit(input: {
    operationId: string
    threadId: string
  }): Promise<PrismaCheckpointCompactionReceipt | null> {
    const prisma = getPrismaClient()
    const rows = await prisma.$queryRaw<RuntimeCompactionCommitRow[]>`
      SELECT
        "thread_id" AS "threadId",
        "operation_id" AS "operationId",
        "checkpoint_ns" AS "checkpointNs",
        "checkpoint_id" AS "checkpointId",
        "expected_checkpoint_id" AS "expectedCheckpointId",
        "compaction",
        "message_count_after_compaction" AS "messageCountAfterCompaction",
        "message_count_before_compaction" AS "messageCountBeforeCompaction",
        "model_id" AS "modelId",
        "preserve_last_user_message_count_present" AS "preserveLastUserMessageCountPresent",
        "reason",
        "requested_preserve_last_user_message_count" AS "requestedPreserveLastUserMessageCount",
        "trigger"
      FROM "runtime_compaction_commits"
      WHERE "thread_id" = ${input.threadId}
        AND "operation_id" = ${input.operationId}
      LIMIT 1
    `
    const row = rows[0]
    return row ? mapRuntimeCompactionCommitRow(row) : null
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

function assertCompactOwnedChannels(values: RuntimeCheckpointCompactionOwnedValues): void {
  const actualChannels = Object.keys(values).sort()
  const expectedChannels = [...COMPACT_OWNED_CHANNELS].sort()
  if (
    actualChannels.length !== expectedChannels.length ||
    actualChannels.some((channel, index) => channel !== expectedChannels[index])
  ) {
    throw new Error(
      `[PrismaCheckpointSaver] Compact must update exactly these channels: ${expectedChannels.join(", ")}.`
    )
  }
}

function assertCompactResult(input: PrismaCheckpointCompactionInput): void {
  const commitMetadata = input.commitMetadata[input.commitMetadataKey] as
    | Record<string, unknown>
    | undefined
  if (
    input.result.compaction.compactionId !== input.operationId ||
    input.result.messageCountAfterCompaction !== commitMetadata?.messageCountAfterCompaction ||
    input.result.messageCountBeforeCompaction !== commitMetadata?.messageCountBeforeCompaction
  ) {
    throw new Error("[PrismaCheckpointSaver] Compact result does not match commit metadata.")
  }
}

function parseRuntimeCompaction(serialized: string, operationId: string): RuntimeCompaction {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error(
      `[PrismaCheckpointSaver] Compact ledger operation "${operationId}" has invalid JSON.`
    )
  }
  if (!isRuntimeCompaction(value) || value.compactionId !== operationId) {
    throw new Error(
      `[PrismaCheckpointSaver] Compact ledger operation "${operationId}" has invalid result data.`
    )
  }
  return value
}

function isRuntimeCompaction(value: unknown): value is RuntimeCompaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.compactionId === "string" &&
    Number.isSafeInteger(record.compactionCount) &&
    (record.compactionCount as number) >= 1 &&
    typeof record.cutoffIndex === "number" &&
    typeof record.createdAt === "string" &&
    isNullableString(record.historyRef) &&
    Number.isSafeInteger(record.preservedUserMessageCount) &&
    (record.preservedUserMessageCount as number) >= 0 &&
    isNullableString(record.reason) &&
    (record.status === "pending" || record.status === "completed" || record.status === "failed") &&
    isNullableString(record.summaryPreview) &&
    typeof record.trigger === "string" &&
    typeof record.updatedAt === "string" &&
    isNullableString(record.warning)
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}
