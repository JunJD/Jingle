import { createHash } from "crypto"
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages"
import { z } from "zod/v4"
import { getChatModelInstance } from "../llm/get-chat-model"
import { listProjectedThreadMessages, type MessageProjectionRow } from "../db/message-state"
import {
  markThreadDigestProjectionError,
  markThreadDigestProjectionPending,
  upsertReadyThreadDigest
} from "../db/thread-digests"
import {
  extractMessageText,
  summarizeMessageContent,
  type AgentMessageContent
} from "@shared/message-content"
import type { ContentBlock } from "@shared/app-types"

const THREAD_DIGEST_GENERATION_TIMEOUT_MS = 8_000
const THREAD_DIGEST_MAX_OUTPUT_TOKENS = 1_024
const MAX_DIGEST_SOURCE_MESSAGES = 80
const MAX_DIGEST_SOURCE_CHARS = 16_000
const MAX_DIGEST_SUMMARY_CHARS = 900
const MAX_DIGEST_LIST_ITEMS = 8
const MAX_DIGEST_LIST_ITEM_CHARS = 140

const threadDigestModelOutputSchema = z
  .object({
    decisions: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
    summary: z.string(),
    topics: z.array(z.string()).default([])
  })
  .strict()

export interface GeneratedThreadDigest {
  decisions: string[]
  openQuestions: string[]
  summary: string
  topics: string[]
}

export type GenerateThreadDigest = (input: {
  messages: MessageProjectionRow[]
  prompt: string
}) => Promise<GeneratedThreadDigest>

let generateThreadDigest: GenerateThreadDigest = generateThreadDigestWithModel
let threadDigestModelUnavailableReason: string | null = null

function getErrorField(error: unknown, field: string): unknown {
  return error && typeof error === "object" && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function isThreadDigestModelAccessError(error: unknown): boolean {
  const code = getErrorField(error, "code")
  const type = getErrorField(error, "type")
  const status = getErrorField(error, "status")
  const message = getErrorText(error)
  return (
    code === "Arrearage" ||
    type === "Arrearage" ||
    status === 401 ||
    status === 403 ||
    /access denied|account is in good standing|overdue-payment|arrearage/i.test(message)
  )
}

function parseIndexedMessageContent(
  content: string
): string | ContentBlock[] | AgentMessageContent {
  const parsed = JSON.parse(content) as unknown
  if (typeof parsed === "string" || Array.isArray(parsed)) {
    return parsed as string | ContentBlock[] | AgentMessageContent
  }

  throw new Error("[ThreadDigestProjector] Indexed message content must be text or content blocks.")
}

function normalizeText(value: string, maxChars: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxChars).trim()
}

function normalizeList(items: string[]): string[] {
  const normalized = items.flatMap((item) => {
    const normalizedItem = normalizeText(item, MAX_DIGEST_LIST_ITEM_CHARS)
    return normalizedItem ? [normalizedItem] : []
  })
  return Array.from(new Set(normalized)).slice(0, MAX_DIGEST_LIST_ITEMS)
}

function normalizeDigest(digest: GeneratedThreadDigest): GeneratedThreadDigest {
  const summary = normalizeText(digest.summary, MAX_DIGEST_SUMMARY_CHARS)
  if (!summary) {
    throw new Error("[ThreadDigestProjector] Generated digest summary is empty.")
  }

  return {
    decisions: normalizeList(digest.decisions),
    openQuestions: normalizeList(digest.openQuestions),
    summary,
    topics: normalizeList(digest.topics)
  }
}

function getMessageDigestText(message: MessageProjectionRow): string {
  const parsedContent = parseIndexedMessageContent(message.content)
  const text = extractMessageText(parsedContent).trim()
  const summary = summarizeMessageContent(parsedContent).trim()
  const body = text || summary
  if (!body) {
    return ""
  }

  return `[${message.seq}] ${message.role}: ${normalizeText(body, 1_000)}`
}

function selectDigestSourceMessages(messages: MessageProjectionRow[]): MessageProjectionRow[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_DIGEST_SOURCE_MESSAGES)
}

function buildDigestPrompt(messages: MessageProjectionRow[]): string {
  let remainingChars = MAX_DIGEST_SOURCE_CHARS
  const lines: string[] = []

  for (const message of messages) {
    const line = getMessageDigestText(message)
    if (!line) {
      continue
    }

    const nextLine = line.length > remainingChars ? line.slice(0, remainingChars).trim() : line
    if (!nextLine) {
      break
    }

    lines.push(nextLine)
    remainingChars -= nextLine.length + 1
    if (remainingChars <= 0) {
      break
    }
  }

  return [
    "Summarize this thread for future local retrieval.",
    "Return strict JSON only with keys: summary, topics, decisions, openQuestions.",
    "Keep summary factual and compact. Do not invent facts not present in the messages.",
    "---BEGIN THREAD MESSAGES---",
    lines.join("\n"),
    "---END THREAD MESSAGES---"
  ].join("\n")
}

function getDigestSourceHash(messages: MessageProjectionRow[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        messages.map((message) => ({
          content: message.content,
          messageId: message.message_id,
          role: message.role,
          seq: message.seq
        }))
      )
    )
    .digest("hex")
}

function extractModelResponseText(content: AIMessage["content"]): string {
  if (typeof content === "string") {
    return content
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block
      }

      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        return block.text
      }

      return ""
    })
    .join("")
}

function parseModelDigestContent(content: AIMessage["content"]): GeneratedThreadDigest {
  const raw = extractModelResponseText(content).trim()
  const parsed = JSON.parse(raw) as unknown
  return normalizeDigest(threadDigestModelOutputSchema.parse(parsed))
}

async function generateThreadDigestWithModel(input: {
  prompt: string
}): Promise<GeneratedThreadDigest> {
  const model = getChatModelInstance({
    maxOutputTokens: THREAD_DIGEST_MAX_OUTPUT_TOKENS,
    modelPreference: "fast",
    temperature: 0,
    thinkingEffort: "off"
  })
  const response = await model
    .withConfig({ runName: "thread_digest" })
    .invoke(
      [
        new SystemMessage(
          "You write compact, factual thread summaries for local search. Reply with valid JSON only."
        ),
        new HumanMessage(input.prompt)
      ],
      { timeout: THREAD_DIGEST_GENERATION_TIMEOUT_MS }
    )

  return parseModelDigestContent(response.content)
}

export async function projectThreadDigest(threadId: string): Promise<void> {
  if (threadDigestModelUnavailableReason) {
    await markThreadDigestProjectionError(threadId, threadDigestModelUnavailableReason)
    return
  }

  await markThreadDigestProjectionPending(threadId)

  const allMessages = await listProjectedThreadMessages(threadId)
  const sourceMessages = selectDigestSourceMessages(allMessages)
  if (sourceMessages.length === 0) {
    return
  }

  const prompt = buildDigestPrompt(sourceMessages)
  let digest: GeneratedThreadDigest
  try {
    digest = normalizeDigest(await generateThreadDigest({ messages: sourceMessages, prompt }))
  } catch (error) {
    if (isThreadDigestModelAccessError(error)) {
      threadDigestModelUnavailableReason = getErrorText(error)
    }
    throw error
  }
  await upsertReadyThreadDigest({
    ...digest,
    messageCount: allMessages.length,
    projectedThroughSeq: Math.max(...allMessages.map((message) => message.seq)),
    sourceHash: getDigestSourceHash(sourceMessages),
    threadId
  })
}

export async function markThreadDigestProjectionFailed(
  threadId: string,
  error: unknown
): Promise<void> {
  await markThreadDigestProjectionError(
    threadId,
    error instanceof Error ? error.message : String(error)
  )
}

export function setThreadDigestGeneratorForTests(generator: GenerateThreadDigest): () => void {
  const previous = generateThreadDigest
  const previousUnavailableReason = threadDigestModelUnavailableReason
  generateThreadDigest = generator
  threadDigestModelUnavailableReason = null
  return () => {
    generateThreadDigest = previous
    threadDigestModelUnavailableReason = previousUnavailableReason
  }
}

export const threadDigestProjectionInternals = {
  buildDigestPrompt,
  getDigestSourceHash,
  normalizeDigest,
  extractModelResponseText,
  parseModelDigestContent,
  selectDigestSourceMessages
}
