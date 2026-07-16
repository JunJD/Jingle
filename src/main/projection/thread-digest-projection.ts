import { createHash } from "crypto"
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages"
import { z } from "zod/v4"
import { getChatModelInstance } from "../llm/get-chat-model"
import { listProjectedThreadMessages, type MessageProjectionRow } from "../db/message-state"
import { upsertReadyThreadDigest, type UpsertReadyThreadDigestInput } from "../db/thread-digests"
import {
  extractMessageText,
  parsePersistedMessageContent,
  summarizeMessageContent
} from "@shared/message-content"

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
  signal?: AbortSignal
}) => Promise<GeneratedThreadDigest>

let generateThreadDigest: GenerateThreadDigest = generateThreadDigestWithModel

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
  const parsedContent = parsePersistedMessageContent(message.content, {
    role: message.role === "assistant" ? "assistant" : "user",
    onInvalid: (reason) => {
      console.warn("[ThreadDigestProjector] Invalid persisted message content.", {
        messageId: message.message_id,
        reason,
        threadId: message.thread_id
      })
    }
  })
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

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = getMessageDigestText(messages[index])
    if (!line) {
      continue
    }

    const nextLine = line.length > remainingChars ? line.slice(0, remainingChars).trim() : line
    if (!nextLine) {
      break
    }

    lines.unshift(nextLine)
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
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error("[ThreadDigestProjector] Model response is not valid JSON.")
  }
  const validated = threadDigestModelOutputSchema.safeParse(parsed)
  if (!validated.success) {
    throw new Error("[ThreadDigestProjector] Model response does not match the digest schema.")
  }
  return normalizeDigest(validated.data)
}

async function generateThreadDigestWithModel(input: {
  prompt: string
  signal?: AbortSignal
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
      { signal: input.signal, timeout: THREAD_DIGEST_GENERATION_TIMEOUT_MS }
    )

  return parseModelDigestContent(response.content)
}

export async function prepareThreadDigestProjection(
  threadId: string,
  signal?: AbortSignal
): Promise<UpsertReadyThreadDigestInput> {
  const allMessages = await listProjectedThreadMessages(threadId)
  const sourceMessages = selectDigestSourceMessages(allMessages)
  if (sourceMessages.length === 0) {
    throw new Error("This thread has no user or assistant messages to summarize.")
  }

  signal?.throwIfAborted()
  const prompt = buildDigestPrompt(sourceMessages)
  const digest = normalizeDigest(
    await generateThreadDigest({ messages: sourceMessages, prompt, signal })
  )
  signal?.throwIfAborted()
  return {
    ...digest,
    messageCount: allMessages.length,
    projectedThroughSeq: Math.max(...allMessages.map((message) => message.seq)),
    sourceHash: getDigestSourceHash(sourceMessages),
    threadId
  }
}

export function commitThreadDigestProjection(input: UpsertReadyThreadDigestInput): Promise<void> {
  return upsertReadyThreadDigest(input)
}

export async function projectThreadDigest(threadId: string, signal?: AbortSignal): Promise<void> {
  const projection = await prepareThreadDigestProjection(threadId, signal)
  signal?.throwIfAborted()
  await commitThreadDigestProjection(projection)
}

export function setThreadDigestGeneratorForTests(generator: GenerateThreadDigest): () => void {
  const previous = generateThreadDigest
  generateThreadDigest = generator
  return () => {
    generateThreadDigest = previous
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
