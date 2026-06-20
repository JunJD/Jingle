import { createHash, randomUUID } from "crypto"
import type { SerializerProtocol } from "@langchain/langgraph-checkpoint"
import type { PrismaClient } from "@prisma/client"
import type { ContentBlock } from "@shared/app-types"
import {
  extractComposerMessageRefsMetadata,
  extractMessageText,
  summarizeMessageContent,
  type AgentMessageContent
} from "@shared/message-content"
import { buildSegmentedSearchText } from "../search-text"
import { getPrismaClient } from "./client"

export type MessageEventType = "message.upsert" | "message.remove"

export interface MessageProjectionRow {
  content: string
  created_at: number
  kind: string
  message_id: string
  metadata: string | null
  name: string | null
  raw_message: string
  role: string
  seq: number
  tool_call_id: string | null
  tool_calls: string | null
}

export interface PreparedMessageStateItem {
  content: string
  kind: string
  messageId: string
  metadata: string | null
  name: string | null
  order: number
  rawHash: string
  rawMessageEncoding: "base64" | "text"
  rawMessageType: string
  rawMessageValue: string
  role: string
  toolCallId: string | null
  toolCalls: string | null
}

interface PersistMessageStateInput {
  checkpointId: string
  checkpointNs: string
  messages?: PreparedMessageStateItem[]
  runId: string | null
  threadId: string
  version: string
}

interface MessageStateVersionInput {
  checkpointNs: string
  serde: SerializerProtocol
  threadId: string
  version: string
}

interface CheckpointMessageStateInput {
  checkpointNs: string
  messageId: string
  threadId: string
  version: string
}

interface LoadedMessageState {
  items: PreparedMessageStateItem[]
  throughSeq: number
}

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>

function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error("[MessageState] Cannot serialize undefined as message state payload.")
  }
  return serialized
}

function encodeRawMessagePayload(value: Uint8Array | string): {
  encoding: "base64" | "text"
  value: string
} {
  if (typeof value === "string") {
    return {
      encoding: "text",
      value
    }
  }

  return {
    encoding: "base64",
    value: Buffer.from(value).toString("base64")
  }
}

function decodeRawMessagePayload(input: {
  encoding: "base64" | "text"
  value: string
}): Uint8Array | string {
  return input.encoding === "text"
    ? input.value
    : Uint8Array.from(Buffer.from(input.value, "base64"))
}

function hashText(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getSerializedMessageClassName(message: unknown): string {
  if (!isRecord(message)) {
    return ""
  }

  const id = message.id
  return Array.isArray(id) ? String(id[id.length - 1] ?? "") : ""
}

function readKwargs(message: unknown): Record<string, unknown> {
  if (!isRecord(message) || !isRecord(message.kwargs)) {
    return {}
  }

  return message.kwargs
}

function resolveMessageRole(message: unknown): "assistant" | "system" | "tool" | "user" {
  const className = getSerializedMessageClassName(message)
  if (className.includes("Human")) return "user"
  if (className.includes("System")) return "system"
  if (className.includes("Tool")) return "tool"
  if (className.includes("AI")) return "assistant"

  const kwargs = readKwargs(message)
  const type = isRecord(message) && typeof message.type === "string" ? message.type : null
  const lcType = typeof kwargs.type === "string" ? kwargs.type : type
  if (lcType === "human") return "user"
  if (lcType === "system") return "system"
  if (lcType === "tool") return "tool"
  if (lcType === "ai") return "assistant"

  if (isRecord(message) && typeof message._getType === "function") {
    const getType = message._getType as () => unknown
    const value = getType()
    if (value === "human") return "user"
    if (value === "system") return "system"
    if (value === "tool") return "tool"
    if (value === "ai") return "assistant"
  }

  throw new Error("[MessageState] Cannot resolve LangGraph message role.")
}

function readMessageContent(message: unknown): string | unknown[] {
  const kwargs = readKwargs(message)
  const value =
    Object.prototype.hasOwnProperty.call(kwargs, "content") && kwargs.content !== undefined
      ? kwargs.content
      : isRecord(message)
        ? message.content
        : undefined

  if (typeof value === "string" || Array.isArray(value)) {
    return value
  }

  return ""
}

function readMessageId(input: {
  message: unknown
  order: number
  rawHash: string
  role: string
}): string {
  const { message } = input
  const kwargs = readKwargs(message)
  const candidates = [
    kwargs.id,
    isRecord(message) ? message.id : undefined,
    kwargs.tool_call_id,
    isRecord(message) ? message.tool_call_id : undefined
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  return `message:${input.rawHash}:${input.order}:${input.role}`
}

function readToolCalls(message: unknown): string | null {
  const kwargs = readKwargs(message)
  const direct = kwargs.tool_calls ?? (isRecord(message) ? message.tool_calls : undefined)
  return Array.isArray(direct) && direct.length > 0 ? stableStringify(direct) : null
}

function readToolCallId(message: unknown): string | null {
  const kwargs = readKwargs(message)
  const value = kwargs.tool_call_id ?? (isRecord(message) ? message.tool_call_id : undefined)
  return typeof value === "string" && value.length > 0 ? value : null
}

function readName(message: unknown): string | null {
  const kwargs = readKwargs(message)
  const value = kwargs.name ?? (isRecord(message) ? message.name : undefined)
  return typeof value === "string" && value.length > 0 ? value : null
}

function readMetadata(message: unknown): string | null {
  const kwargs = readKwargs(message)
  const directAdditionalKwargs = isRecord(message) && isRecord(message.additional_kwargs)
    ? message.additional_kwargs
    : {}
  const additionalKwargs = isRecord(kwargs.additional_kwargs)
    ? kwargs.additional_kwargs
    : directAdditionalKwargs
  const refs = extractComposerMessageRefsMetadata(additionalKwargs)
  const metadata: Record<string, unknown> = {}

  if (refs.length > 0) {
    metadata.refs = refs
  }

  if (additionalKwargs.lc_source === "summarization") {
    metadata.lc_source = "summarization"
  }

  return Object.keys(metadata).length > 0 ? stableStringify(metadata) : null
}

function parseIndexedMessageContent(
  content: string
): string | ContentBlock[] | AgentMessageContent {
  const parsed = JSON.parse(content) as unknown
  if (typeof parsed === "string" || Array.isArray(parsed)) {
    return parsed as string | ContentBlock[] | AgentMessageContent
  }

  throw new Error("[MessageState] Indexed message content must be a string or content array.")
}

function parseIndexedMessageRefs(metadata: string | null): ReturnType<
  typeof extractComposerMessageRefsMetadata
> {
  if (!metadata) {
    return []
  }

  return extractComposerMessageRefsMetadata(JSON.parse(metadata) as unknown)
}

function buildIndexedMessageSearchText(input: {
  content: string
  metadata: string | null
}): string {
  const parsedContent = parseIndexedMessageContent(input.content)
  const refs = parseIndexedMessageRefs(input.metadata)

  const refLabels = refs.map((ref) => {
    switch (ref.type) {
      case "file":
        return ref.name
      case "image":
        return ref.name ?? "Attached image"
      case "assistant-message-selection":
        return ref.selectedText
      default:
        return ""
    }
  })

  const extractedText = extractMessageText(parsedContent).trim()
  const candidateParts = [
    extractedText,
    summarizeMessageContent(parsedContent).trim(),
    buildSegmentedSearchText(extractedText)?.trim() ?? "",
    ...refLabels.map((part) => part.trim())
  ]

  return Array.from(new Set(candidateParts.filter(Boolean))).join("\n")
}

async function serializeMessageStateItem(input: {
  index: number
  message: unknown
  serde: SerializerProtocol
}): Promise<PreparedMessageStateItem> {
  const role = resolveMessageRole(input.message)
  const [rawMessageType, serializedRawMessage] = await input.serde.dumpsTyped(input.message)
  const rawMessagePayload = encodeRawMessagePayload(serializedRawMessage)
  const rawHash = hashText(serializedRawMessage)
  const rawContent = readMessageContent(input.message)
  const content = stableStringify(rawContent)
  const metadata = readMetadata(input.message)

  return {
    content,
    kind: role === "tool" ? "tool_result" : "message",
    messageId: readMessageId({
      message: input.message,
      order: input.index + 1,
      rawHash,
      role
    }),
    metadata,
    name: readName(input.message),
    order: input.index + 1,
    rawHash,
    rawMessageEncoding: rawMessagePayload.encoding,
    rawMessageType,
    rawMessageValue: rawMessagePayload.value,
    role,
    toolCallId: readToolCallId(input.message),
    toolCalls: readToolCalls(input.message)
  }
}

function buildStateHash(items: PreparedMessageStateItem[]): string {
  return hashText(
    stableStringify(
      items.map((item) => ({
        messageId: item.messageId,
        order: item.order,
        rawHash: item.rawHash
      }))
    )
  )
}

async function readNextMessageEventSeq(
  tx: TransactionClient,
  threadId: string,
  checkpointNs: string
): Promise<number> {
  const latest = await tx.messageEvent.findFirst({
    orderBy: { seq: "desc" },
    select: { seq: true },
    where: {
      checkpointNs,
      threadId
    }
  })

  return (latest?.seq ?? 0) + 1
}

function parseMessageStateEventItem(event: {
  eventId: string
  payload: string
}): PreparedMessageStateItem {
  const payload = JSON.parse(event.payload) as Partial<PreparedMessageStateItem>
  if (
    typeof payload.messageId !== "string" ||
    (payload.rawMessageEncoding !== "base64" && payload.rawMessageEncoding !== "text") ||
    typeof payload.rawMessageType !== "string" ||
    typeof payload.rawMessageValue !== "string" ||
    typeof payload.rawHash !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.kind !== "string" ||
    typeof payload.content !== "string" ||
    typeof payload.order !== "number"
  ) {
    throw new Error(`[MessageState] Message event "${event.eventId}" has an invalid payload.`)
  }
  const rawMessageEncoding = payload.rawMessageEncoding

  return {
    content: payload.content,
    kind: payload.kind,
    messageId: payload.messageId,
    metadata: payload.metadata ?? null,
    name: payload.name ?? null,
    order: payload.order,
    rawHash: payload.rawHash,
    rawMessageEncoding,
    rawMessageType: payload.rawMessageType,
    rawMessageValue: payload.rawMessageValue,
    role: payload.role,
    toolCallId: payload.toolCallId ?? null,
    toolCalls: payload.toolCalls ?? null
  }
}

async function loadMessageStateItemsThroughSeq(
  tx: TransactionClient,
  input: {
    checkpointNs: string
    threadId: string
    throughSeq: number
  }
): Promise<PreparedMessageStateItem[]> {
  if (input.throughSeq <= 0) {
    return []
  }

  const events = await tx.messageEvent.findMany({
    orderBy: { seq: "asc" },
    where: {
      checkpointNs: input.checkpointNs,
      seq: {
        lte: input.throughSeq
      },
      threadId: input.threadId
    }
  })
  const messages = new Map<string, PreparedMessageStateItem>()

  for (const event of events) {
    if (event.type === "message.remove" && event.messageId) {
      messages.delete(event.messageId)
      continue
    }

    if (event.type === "message.upsert" && event.messageId) {
      messages.set(event.messageId, parseMessageStateEventItem(event))
      continue
    }

    throw new Error(`[MessageState] Unsupported message event type "${event.type}".`)
  }

  return Array.from(messages.values()).sort((left, right) => left.order - right.order)
}

async function loadLatestMessageState(
  tx: TransactionClient,
  input: {
    checkpointNs: string
    threadId: string
  }
): Promise<LoadedMessageState> {
  const latest = await tx.messageStateVersion.findFirst({
    orderBy: { throughSeq: "desc" },
    where: {
      checkpointNs: input.checkpointNs,
      threadId: input.threadId
    }
  })

  if (!latest) {
    return {
      items: [],
      throughSeq: 0
    }
  }

  return {
    items: await loadMessageStateItemsThroughSeq(tx, {
      checkpointNs: input.checkpointNs,
      threadId: input.threadId,
      throughSeq: latest.throughSeq
    }),
    throughSeq: latest.throughSeq
  }
}

async function deleteProjectedMessage(
  tx: TransactionClient,
  input: {
    messageId: string
    threadId: string
  }
): Promise<void> {
  await tx.message.deleteMany({
    where: {
      messageId: input.messageId,
      threadId: input.threadId
    }
  })
  await tx.$executeRawUnsafe(
    `DELETE FROM "messages_fts" WHERE thread_id = ? AND message_id = ?`,
    input.threadId,
    input.messageId
  )
  await tx.$executeRawUnsafe(
    `DELETE FROM "messages_fts_trigram" WHERE thread_id = ? AND message_id = ?`,
    input.threadId,
    input.messageId
  )
}

async function replaceMessageSearchIndex(
  tx: TransactionClient,
  input: {
    messageId: string
    role: string
    searchText: string
    threadId: string
  }
): Promise<void> {
  await tx.$executeRawUnsafe(
    `DELETE FROM "messages_fts" WHERE thread_id = ? AND message_id = ?`,
    input.threadId,
    input.messageId
  )
  await tx.$executeRawUnsafe(
    `DELETE FROM "messages_fts_trigram" WHERE thread_id = ? AND message_id = ?`,
    input.threadId,
    input.messageId
  )

  if (input.searchText.length === 0) {
    return
  }

  await tx.$executeRawUnsafe(
    `INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text")
     VALUES (?, ?, ?, ?)`,
    input.threadId,
    input.messageId,
    input.role,
    input.searchText
  )
  await tx.$executeRawUnsafe(
    `INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
     VALUES (?, ?, ?, ?)`,
    input.threadId,
    input.messageId,
    input.role,
    input.searchText
  )
}

async function upsertProjectedMessage(
  tx: TransactionClient,
  input: {
    item: PreparedMessageStateItem
    now: bigint
    runId: string | null
    threadId: string
  }
): Promise<void> {
  const searchText = buildIndexedMessageSearchText({
    content: input.item.content,
    metadata: input.item.metadata
  })
  const rawMessage = stableStringify({
    encoding: input.item.rawMessageEncoding,
    type: input.item.rawMessageType,
    value: input.item.rawMessageValue
  })

  await tx.message.upsert({
    create: {
      content: input.item.content,
      createdAt: input.now + BigInt(input.item.order),
      kind: input.item.kind,
      messageId: input.item.messageId,
      metadata: input.item.metadata,
      name: input.item.name,
      rawHash: input.item.rawHash,
      rawMessage,
      role: input.item.role,
      runId: input.runId,
      searchText,
      seq: input.item.order,
      threadId: input.threadId,
      toolCallId: input.item.toolCallId,
      toolCalls: input.item.toolCalls,
      updatedAt: input.now
    },
    update: {
      content: input.item.content,
      kind: input.item.kind,
      metadata: input.item.metadata,
      name: input.item.name,
      rawHash: input.item.rawHash,
      rawMessage,
      role: input.item.role,
      runId: input.runId,
      searchText,
      seq: input.item.order,
      toolCallId: input.item.toolCallId,
      toolCalls: input.item.toolCalls,
      updatedAt: input.now
    },
    where: {
      threadId_messageId: {
        messageId: input.item.messageId,
        threadId: input.threadId
      }
    }
  })
  await replaceMessageSearchIndex(tx, {
    messageId: input.item.messageId,
    role: input.item.role,
    searchText,
    threadId: input.threadId
  })
}

export async function prepareMessageStateItems(input: {
  messages: unknown[]
  serde: SerializerProtocol
}): Promise<PreparedMessageStateItem[]> {
  return Promise.all(
    input.messages.map((message, index) =>
      serializeMessageStateItem({
        index,
        message,
        serde: input.serde
      })
    )
  )
}

export async function persistMessageStateVersion(
  input: PersistMessageStateInput,
  tx: TransactionClient = getPrismaClient()
): Promise<void> {
  const now = BigInt(Date.now())
  const previous = await loadLatestMessageState(tx, {
    checkpointNs: input.checkpointNs,
    threadId: input.threadId
  })
  if (input.messages === undefined && previous.throughSeq === 0) {
    throw new Error(
      `[MessageState] Checkpoint "${input.checkpointId}" references messages version "${input.version}" before any message facts exist.`
    )
  }

  const items =
    input.messages === undefined
      ? previous.items
      : input.messages
  const stateHash = buildStateHash(items)
  let seq = await readNextMessageEventSeq(tx, input.threadId, input.checkpointNs)
  const previousById = new Map(previous.items.map((item) => [item.messageId, item]))
  const nextIds = new Set(items.map((item) => item.messageId))
  const removedItems =
    input.messages === undefined
      ? []
      : previous.items.filter((item) => !nextIds.has(item.messageId))
  const changedItems =
    input.messages === undefined
      ? []
      : items.filter((item) => {
          const previousItem = previousById.get(item.messageId)
          return (
            !previousItem ||
            previousItem.rawHash !== item.rawHash ||
            previousItem.order !== item.order
          )
        })

  const shouldUpdateProjection = input.checkpointNs === ""

  for (const item of removedItems) {
    await tx.messageEvent.create({
      data: {
        checkpointId: input.checkpointId,
        checkpointNs: input.checkpointNs,
        createdAt: now,
        eventId: randomUUID(),
        messageId: item.messageId,
        payload: stableStringify({
          messageId: item.messageId,
          stateHash,
          version: input.version
        }),
        runId: input.runId,
        seq,
        threadId: input.threadId,
        type: "message.remove"
      }
    })

    if (shouldUpdateProjection) {
      await deleteProjectedMessage(tx, {
        messageId: item.messageId,
        threadId: input.threadId
      })
    }

    seq += 1
  }

  for (const item of changedItems) {
    await tx.messageEvent.create({
      data: {
        checkpointId: input.checkpointId,
        checkpointNs: input.checkpointNs,
        createdAt: now,
        eventId: randomUUID(),
        messageId: item.messageId,
        payload: stableStringify(item),
        runId: input.runId,
        seq,
        threadId: input.threadId,
        type: "message.upsert"
      }
    })

    if (shouldUpdateProjection) {
      await upsertProjectedMessage(tx, {
        item,
        now,
        runId: input.runId,
        threadId: input.threadId
      })
    }

    seq += 1
  }

  await tx.messageStateVersion.upsert({
    create: {
      checkpointNs: input.checkpointNs,
      createdAt: now,
      stateHash,
      threadId: input.threadId,
      throughSeq:
        changedItems.length > 0 || removedItems.length > 0 ? seq - 1 : previous.throughSeq,
      version: input.version
    },
    update: {
      createdAt: now,
      stateHash,
      throughSeq:
        changedItems.length > 0 || removedItems.length > 0 ? seq - 1 : previous.throughSeq
    },
    where: {
      threadId_checkpointNs_version: {
        checkpointNs: input.checkpointNs,
        threadId: input.threadId,
        version: input.version
      }
    }
  })
}

export async function loadMessagesForStateVersion(
  input: MessageStateVersionInput,
  tx: TransactionClient = getPrismaClient()
): Promise<unknown[]> {
  const stateVersion = await tx.messageStateVersion.findUnique({
    where: {
      threadId_checkpointNs_version: {
        checkpointNs: input.checkpointNs,
        threadId: input.threadId,
        version: input.version
      }
    }
  })

  if (!stateVersion) {
    throw new Error(
      `[MessageState] Missing message state version "${input.version}" for thread "${input.threadId}" namespace "${input.checkpointNs}".`
    )
  }

  const items = await loadMessageStateItemsThroughSeq(tx, {
    checkpointNs: input.checkpointNs,
    threadId: input.threadId,
    throughSeq: stateVersion.throughSeq
  })

  return Promise.all(
    items.map((item) =>
      input.serde.loadsTyped(
        item.rawMessageType,
        decodeRawMessagePayload({
          encoding: item.rawMessageEncoding,
          value: item.rawMessageValue
        })
      )
    )
  )
}

export async function projectMessageStateThroughSeq(
  input: {
    checkpointNs: string
    runId: string | null
    sourceThreadId: string
    targetThreadId: string
    throughSeq: number
    updatedAt: bigint
  },
  tx: TransactionClient = getPrismaClient()
): Promise<void> {
  const items = await loadMessageStateItemsThroughSeq(tx, {
    checkpointNs: input.checkpointNs,
    threadId: input.sourceThreadId,
    throughSeq: input.throughSeq
  })

  for (const item of items) {
    await upsertProjectedMessage(tx, {
      item,
      now: input.updatedAt,
      runId: input.runId,
      threadId: input.targetThreadId
    })
  }
}

export async function checkpointMessageStateIncludesMessage(
  input: CheckpointMessageStateInput,
  tx: TransactionClient = getPrismaClient()
): Promise<boolean> {
  const stateVersion = await tx.messageStateVersion.findUnique({
    select: { throughSeq: true },
    where: {
      threadId_checkpointNs_version: {
        checkpointNs: input.checkpointNs,
        threadId: input.threadId,
        version: input.version
      }
    }
  })

  if (!stateVersion) {
    throw new Error(
      `[MessageState] Missing message state version "${input.version}" for thread "${input.threadId}" namespace "${input.checkpointNs}".`
    )
  }

  const latestEvent = await tx.messageEvent.findFirst({
    orderBy: { seq: "desc" },
    select: { type: true },
    where: {
      checkpointNs: input.checkpointNs,
      messageId: input.messageId,
      seq: {
        lte: stateVersion.throughSeq
      },
      threadId: input.threadId
    }
  })

  return latestEvent?.type === "message.upsert"
}

export async function listProjectedThreadMessages(threadId: string): Promise<MessageProjectionRow[]> {
  const rows = await getPrismaClient().message.findMany({
    orderBy: { seq: "asc" },
    where: { threadId }
  })

  return rows.map((row) => ({
    content: row.content,
    created_at: Number(row.createdAt),
    kind: row.kind,
    message_id: row.messageId,
    metadata: row.metadata,
    name: row.name,
    raw_message: row.rawMessage,
    role: row.role,
    seq: row.seq,
    tool_call_id: row.toolCallId,
    tool_calls: row.toolCalls
  }))
}
