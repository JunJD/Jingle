import type { ContentBlock } from "./app-types"
import {
  buildJingleAgentDisplayMessageContent,
  buildJingleAgentSubmitMessageContentWithRefs,
  hasJingleAgentComposerMessageInputContent,
  hasJingleAgentMessageContent
} from "@jingle/agent-client"

export type AgentMessageContent =
  | string
  | Array<
      | {
          text: string
          type: "text"
        }
      | {
          name?: string
          image_url: string | { detail?: "auto" | "high" | "low"; url: string }
          mimeType?: string
          type: "image_url"
        }
    >

export type ComposerMessageRef =
  | {
      type: "file"
      name: string
      path: string
    }
  | {
      type: "image"
      name?: string
      url: string
    }
  | {
      type: "extension-source"
      extensionName: string
      name: string
      sourceId: string
    }
  | {
      type: "assistant-message-selection"
      selectedText: string
      sourceMessageId: string
      sourceThreadId: string
    }

export interface ComposerMessageInput {
  refs: ComposerMessageRef[]
  text: string
}

export interface AgentInvokeMessage {
  content: AgentMessageContent
  id: string
  refs?: ComposerMessageRef[]
}

export interface AssistantMessageContentSource {
  additional_kwargs?: unknown
  response_metadata?: unknown
}

function normalizeComposerMessageRef(value: unknown): ComposerMessageRef | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const ref = value as {
    extensionName?: unknown
    name?: unknown
    path?: unknown
    selectedText?: unknown
    sourceId?: unknown
    sourceMessageId?: unknown
    sourceThreadId?: unknown
    type?: unknown
    url?: unknown
  }

  if (ref.type === "file") {
    if (typeof ref.name !== "string" || typeof ref.path !== "string") {
      return null
    }

    const name = ref.name.trim()
    const path = ref.path.trim()
    if (!name || !path) {
      return null
    }

    return {
      name,
      path,
      type: "file"
    }
  }

  if (ref.type === "image") {
    if (typeof ref.url !== "string") {
      return null
    }

    const url = ref.url.trim()
    if (!url) {
      return null
    }

    const name = typeof ref.name === "string" ? ref.name.trim() : ""
    return {
      ...(name ? { name } : {}),
      type: "image",
      url
    }
  }

  if (ref.type === "extension-source") {
    if (
      typeof ref.extensionName !== "string" ||
      typeof ref.name !== "string" ||
      typeof ref.sourceId !== "string"
    ) {
      return null
    }

    const extensionName = ref.extensionName.trim()
    const name = ref.name.trim()
    const sourceId = ref.sourceId.trim()
    if (!extensionName || !name || !sourceId) {
      return null
    }

    return {
      extensionName,
      name,
      sourceId,
      type: "extension-source"
    }
  }

  if (ref.type === "assistant-message-selection") {
    if (
      typeof ref.selectedText !== "string" ||
      typeof ref.sourceMessageId !== "string" ||
      typeof ref.sourceThreadId !== "string"
    ) {
      return null
    }

    const selectedText = ref.selectedText.trim()
    const sourceMessageId = ref.sourceMessageId.trim()
    const sourceThreadId = ref.sourceThreadId.trim()
    if (!selectedText || !sourceMessageId || !sourceThreadId) {
      return null
    }

    return {
      selectedText,
      sourceMessageId,
      sourceThreadId,
      type: "assistant-message-selection"
    }
  }

  return null
}

export function normalizeComposerMessageRefs(value: unknown): ComposerMessageRef[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const ref = normalizeComposerMessageRef(entry)
    return ref ? [ref] : []
  })
}

export function toComposerMessageMetadata(
  input: Pick<ComposerMessageInput, "refs">
): Record<string, unknown> | undefined {
  if (input.refs.length === 0) {
    return undefined
  }

  return {
    refs: input.refs
  }
}

export function extractComposerMessageRefsMetadata(metadata: unknown): ComposerMessageRef[] {
  if (!metadata || typeof metadata !== "object") {
    return []
  }

  return normalizeComposerMessageRefs((metadata as { refs?: unknown }).refs)
}

function getSyntheticFileRefsText(refs: ComposerMessageRef[]): string | null {
  const fileNames = refs.flatMap((ref) => {
    if (ref.type !== "file") {
      return []
    }

    const name = ref.name.trim()
    return name ? [name] : []
  })

  if (fileNames.length === 0) {
    return null
  }

  return `Attached files:\n${fileNames.map((name) => `- ${name}`).join("\n")}`
}

function stripSyntheticRefsText(text: string, refs: ComposerMessageRef[]): string {
  const syntheticFileRefsText = getSyntheticFileRefsText(refs)
  if (syntheticFileRefsText && text.trim() === syntheticFileRefsText.trim()) {
    return ""
  }

  return stripSyntheticAssistantSelectionRefsText(text, refs)
}

function stripSyntheticAssistantSelectionRefsText(text: string, refs: ComposerMessageRef[]): string {
  const syntheticAssistantSelectionRefsText = getAssistantSelectionRefsText(refs)
  if (!syntheticAssistantSelectionRefsText) {
    return text
  }

  const trimmedText = text.trim()
  const trimmedSyntheticText = syntheticAssistantSelectionRefsText.trim()
  if (trimmedText === trimmedSyntheticText) {
    return ""
  }

  if (trimmedText.endsWith(trimmedSyntheticText)) {
    return trimmedText.slice(0, -trimmedSyntheticText.length).trimEnd()
  }

  return text
}

function isContentBlockLike(value: unknown): value is ContentBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string"
  )
}

export interface DisplayAssistantMessageContentOptions extends AssistantMessageContentSource {
}

function hasDisplayTextValue(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringProperty(value: Record<string, unknown>, key: string): string | null {
  const property = value[key]
  return typeof property === "string" ? property : null
}

function extractReasoningPayloadText(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(extractReasoningPayloadText).join("")
  }

  if (!isRecord(value)) {
    return ""
  }

  const direct =
    readStringProperty(value, "reasoning") ??
    readStringProperty(value, "reasoning_content") ??
    readStringProperty(value, "thinking") ??
    readStringProperty(value, "text") ??
    readStringProperty(value, "content")

  if (direct !== null) {
    return direct
  }

  return [value.summary, value.content].map(extractReasoningPayloadText).join("")
}

function extractAssistantReasoningText(source: AssistantMessageContentSource): string {
  const additionalKwargs = isRecord(source.additional_kwargs) ? source.additional_kwargs : null
  const responseMetadata = isRecord(source.response_metadata) ? source.response_metadata : null

  return (
    extractReasoningPayloadText(additionalKwargs?.reasoning_content) ||
    extractReasoningPayloadText(additionalKwargs?.reasoning) ||
    extractReasoningPayloadText(additionalKwargs?.thinking) ||
    extractReasoningPayloadText(responseMetadata?.reasoning_content) ||
    extractReasoningPayloadText(responseMetadata?.reasoning) ||
    extractReasoningPayloadText(responseMetadata?.thinking)
  )
}

function normalizeDisplayContentBlock(value: unknown): ContentBlock | null {
  if (!isContentBlockLike(value)) {
    return null
  }

  const block = value as ContentBlock & Record<string, unknown>
  const blockType = block.type as string

  if (blockType === "reasoning") {
    const reasoning =
      readStringProperty(block, "reasoning") ??
      readStringProperty(block, "text") ??
      readStringProperty(block, "content")
    return reasoning !== null ? { reasoning, type: "reasoning" } : null
  }

  if (blockType === "thinking" || blockType === "thinking_delta") {
    const reasoning =
      readStringProperty(block, "thinking") ??
      readStringProperty(block, "text") ??
      readStringProperty(block, "content")
    return reasoning !== null
      ? {
          reasoning,
          ...(typeof block.signature === "string" ? { signature: block.signature } : {}),
          type: "reasoning"
        }
      : null
  }

  if (blockType === "redacted_thinking" || blockType === "signature_delta") {
    return null
  }

  return block
}

export function resolveImageBlockUrl(
  block: Pick<ContentBlock, "content" | "image_url">
): string | null {
  if (typeof block.image_url === "string" && block.image_url.length > 0) {
    return block.image_url
  }

  if (
    block.image_url &&
    typeof block.image_url === "object" &&
    typeof block.image_url.url === "string" &&
    block.image_url.url.length > 0
  ) {
    return block.image_url.url
  }

  if (typeof block.content === "string" && block.content.length > 0) {
    return block.content
  }

  return null
}

export function toDisplayMessageContent(
  content: string | unknown[] | AgentMessageContent | undefined
): string | ContentBlock[] {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content.flatMap((block) => {
    const normalized = normalizeDisplayContentBlock(block)
    return normalized ? [normalized] : []
  })
}

export function toDisplayAssistantMessageContent(
  content: string | unknown[] | AgentMessageContent | undefined,
  options: DisplayAssistantMessageContentOptions = {}
): string | ContentBlock[] {
  const displayContent = toDisplayMessageContent(content)
  const reasoning = extractAssistantReasoningText(options)

  if (typeof displayContent === "string") {
    const text = displayContent
    if (!reasoning.trim()) {
      return text
    }

    const blocks: ContentBlock[] = [{ reasoning, type: "reasoning" }]
    if (text.length > 0) {
      blocks.push({ text, type: "text" })
    }
    return blocks
  }

  const withReasoning =
    reasoning.trim() &&
    !displayContent.some((block) => block.type === "reasoning" && block.reasoning?.trim())
      ? [{ reasoning, type: "reasoning" } satisfies ContentBlock, ...displayContent]
      : displayContent

  return withReasoning.flatMap((block) => {
    if (block.type === "image" || block.type === "image_url" || block.type === "file") {
      return [block]
    }

    if (block.type === "reasoning") {
      return block.reasoning?.trim() ? [block] : []
    }

    const nextBlock = { ...block }
    return hasDisplayTextValue(nextBlock.text) || hasDisplayTextValue(nextBlock.content)
      ? [nextBlock]
      : []
  })
}

function getDisplayBlockText(block: ContentBlock): string {
  return block.text ?? block.content ?? ""
}

export function extractMessageText(
  content: string | ContentBlock[] | AgentMessageContent | undefined
): string {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((block) => {
      if (typeof block !== "object" || block === null || !("type" in block)) {
        return ""
      }

      if (block.type === "reasoning") {
        return ""
      }

      if (block.type === "text" && typeof block.text === "string") {
        return block.text
      }

      if ("text" in block && typeof block.text === "string") {
        return block.text
      }

      if (
        block.type !== "file" &&
        block.type !== "image" &&
        block.type !== "image_url" &&
        "content" in block &&
        typeof block.content === "string"
      ) {
        return block.content
      }

      return ""
    })
    .join("")
}

export function summarizeMessageContent(
  content: string | ContentBlock[] | AgentMessageContent
): string {
  const text = extractMessageText(content).trim()
  if (text) {
    return text
  }

  if (!Array.isArray(content)) {
    return ""
  }

  let imageCount = 0
  const fileNames: string[] = []

  for (const block of content) {
    if (typeof block !== "object" || block === null || !("type" in block)) {
      continue
    }

    if (block.type === "image" || block.type === "image_url") {
      imageCount += 1
      continue
    }

    if (block.type === "file") {
      const name =
        "name" in block && typeof block.name === "string"
          ? block.name
          : "content" in block && typeof block.content === "string"
            ? block.content
            : "Attachment"
      fileNames.push(name)
    }
  }

  if (fileNames.length > 0) {
    return `Attached files: ${fileNames.join(", ")}`
  }

  if (imageCount > 0) {
    return imageCount === 1 ? "Attached image" : `${imageCount} attached images`
  }

  return ""
}

export function hasComposerMessageInputContent(input: ComposerMessageInput | undefined): boolean {
  return hasJingleAgentComposerMessageInputContent(input)
}

export function hasMessageContent(
  content: string | ContentBlock[] | AgentMessageContent | undefined
): boolean {
  return hasJingleAgentMessageContent(content)
}

export function toMessageContent(input: ComposerMessageInput): string | ContentBlock[] {
  return buildJingleAgentDisplayMessageContent(input) as string | ContentBlock[]
}

export function toComposerMessageInput(
  content: string | ContentBlock[] | AgentMessageContent | undefined,
  metadata?: unknown
): ComposerMessageInput {
  const metadataRefs = extractComposerMessageRefsMetadata(metadata)

  if (typeof content === "string") {
    return {
      refs: metadataRefs,
      text: stripSyntheticRefsText(content, metadataRefs)
    }
  }

  if (!Array.isArray(content)) {
    return {
      refs: metadataRefs,
      text: ""
    }
  }

  const textParts: string[] = []
  const refs: ComposerMessageRef[] = []

  for (const block of content) {
    if (typeof block !== "object" || block === null || !("type" in block)) {
      continue
    }

    switch (block.type) {
      case "text":
        if (typeof block.text === "string") {
          const text = stripSyntheticRefsText(block.text, metadataRefs)
          if (text.length > 0) {
            textParts.push(text)
          }
        }
        break
      case "image":
      case "image_url": {
        const url = resolveImageBlockUrl(block)
        if (url) {
          const name =
            "name" in block && typeof block.name === "string" && block.name.length > 0
              ? block.name
              : undefined

          refs.push({
            ...(name ? { name } : {}),
            type: "image",
            url
          })
        }
        break
      }
      case "file": {
        const path = typeof block.content === "string" ? block.content : ""
        const name =
          typeof block.name === "string" && block.name.length > 0
            ? block.name
            : path || "Attachment"

        if (path.trim().length > 0) {
          refs.push({
            name,
            path,
            type: "file"
          })
        }
        break
      }
      default: {
        const text = getDisplayBlockText(block).trim()
        if (text.length > 0) {
          textParts.push(text)
        }
      }
    }
  }

  return {
    refs: metadataRefs.length > 0 ? metadataRefs : refs,
    text: textParts.join("")
  }
}

export function toAgentMessageContent(content: string | ContentBlock[]): AgentMessageContent {
  return buildJingleAgentSubmitMessageContentWithRefs({
    content,
    refs: []
  }) as AgentMessageContent
}

export function toAgentMessageContentWithRefs(
  content: string | ContentBlock[],
  refs: ComposerMessageRef[]
): AgentMessageContent {
  return buildJingleAgentSubmitMessageContentWithRefs({
    content,
    refs
  }) as AgentMessageContent
}

function getAssistantSelectionRefsText(refs: ComposerMessageRef[]): string | null {
  const selections = refs.flatMap((ref) => {
    if (ref.type !== "assistant-message-selection") {
      return []
    }

    const selectedText = ref.selectedText.trim()
    return selectedText ? [selectedText] : []
  })

  if (selections.length === 0) {
    return null
  }

  return `Referenced assistant selections:\n${selections
    .map((selection, index) => `${index + 1}. ${selection}`)
    .join("\n")}`
}

export function toDisplayUserMessageContent(
  content: string | ContentBlock[] | AgentMessageContent | undefined,
  metadata?: unknown
): string | ContentBlock[] {
  return toMessageContent(toComposerMessageInput(content, metadata))
}
