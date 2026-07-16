import type {
  ContentBlock,
  ImageContentBlock,
  ImageUrlContentBlock,
  MessageAttachmentUrlSource,
  MessageContent,
  MessageFileSource,
  MessageImageSource,
  UnrenderableContentBlock,
  UnrenderableContentBlockReason
} from "./app-types"
import {
  buildJingleAgentDisplayMessageContent,
  buildJingleAgentSubmitMessageContentWithRefs,
  hasJingleAgentComposerMessageInputContent,
  type JingleAgentMessageContentBlock
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
  const ref = readSafeDataRecord(value)
  if (!ref) {
    return null
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
  const refs = readSafeArray(value)
  if (!refs) {
    return []
  }

  return refs.flatMap((entry) => {
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
  const record = readSafeDataRecord(metadata)
  return record ? normalizeComposerMessageRefs(record.refs) : []
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

function stripSyntheticAssistantSelectionRefsText(
  text: string,
  refs: ComposerMessageRef[]
): string {
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

export interface DisplayAssistantMessageContentOptions extends AssistantMessageContentSource {}

export type MessageContentRole = "assistant" | "system" | "tool" | "user"

export interface DisplayMessageContentOptions {
  role: MessageContentRole
  toolCallId?: string | null
}

export type PersistedMessageContentFailureReason = "invalid-json" | "noncanonical"

export interface ParsePersistedMessageContentOptions extends DisplayMessageContentOptions {
  onInvalid?: (reason: PersistedMessageContentFailureReason) => void
}

type SafeDataRecord = Readonly<Record<string, unknown>>

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function createUnrenderableContentBlock(
  reason: UnrenderableContentBlockReason,
  sourceType: string | null
): UnrenderableContentBlock {
  return { reason, sourceType, type: "unrenderable" }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)])
    )
  }
  return value
}

function createInvalidPersistedMessageContent(
  options: ParsePersistedMessageContentOptions,
  reason: PersistedMessageContentFailureReason
): MessageContent {
  options.onInvalid?.(reason)
  return [createUnrenderableContentBlock("malformed", "persisted_message_content")]
}

export function parsePersistedMessageContent(
  serialized: string,
  options: ParsePersistedMessageContentOptions
): MessageContent {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch {
    return createInvalidPersistedMessageContent(options, "invalid-json")
  }

  if (typeof parsed === "string") {
    return parsed
  }
  if (!Array.isArray(parsed)) {
    return createInvalidPersistedMessageContent(options, "noncanonical")
  }

  const canonical = toDisplayMessageContent(parsed, options)
  if (JSON.stringify(stableJsonValue(parsed)) !== JSON.stringify(stableJsonValue(canonical))) {
    return createInvalidPersistedMessageContent(options, "noncanonical")
  }
  return canonical
}

function readSafeDataRecord(value: unknown): SafeDataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return null
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      return null
    }

    const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(value)
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || !descriptor.enumerable) {
        return null
      }
      result[key] = descriptor.value
    }
    return result
  } catch {
    return null
  }
}

function readSafeArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  try {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length
    ) {
      return null
    }

    const descriptors = Object.getOwnPropertyDescriptors(value as object) as PropertyDescriptorMap
    const lengthDescriptor = descriptors.length
    if (!(lengthDescriptor && "value" in lengthDescriptor)) {
      return null
    }

    const lengthValue: unknown = lengthDescriptor.value
    if (!Number.isSafeInteger(lengthValue) || typeof lengthValue !== "number" || lengthValue < 0) {
      return null
    }
    const length = lengthValue

    const result: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]
      if (!(descriptor && "value" in descriptor && descriptor.enumerable)) {
        return null
      }
      result.push(descriptor.value)
    }

    if (
      Object.keys(descriptors).length !== length + 1 ||
      Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
    ) {
      return null
    }
    return result
  } catch {
    return null
  }
}

function hasOwn(record: SafeDataRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function readOptionalString(
  record: SafeDataRecord,
  keys: readonly string[]
): { ok: true; value?: string } | { ok: false } {
  let result: string | undefined
  for (const key of keys) {
    if (!hasOwn(record, key)) {
      continue
    }
    const value = record[key]
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false }
    }
    const normalized = value.trim()
    if (result !== undefined && result !== normalized) {
      return { ok: false }
    }
    result = normalized
  }
  return result === undefined ? { ok: true } : { ok: true, value: result }
}

function readOptionalRawString(
  record: SafeDataRecord,
  keys: readonly string[]
): { ok: true; value?: string } | { ok: false } {
  let result: string | undefined
  for (const key of keys) {
    if (!hasOwn(record, key)) {
      continue
    }
    const value = record[key]
    if (typeof value !== "string" || (result !== undefined && result !== value)) {
      return { ok: false }
    }
    result = value
  }
  return result === undefined ? { ok: true } : { ok: true, value: result }
}

function encodeBase64(bytes: Uint8Array): string | null {
  try {
    if (Object.getPrototypeOf(bytes) !== Uint8Array.prototype) {
      return null
    }
    let result = ""
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index] ?? 0
      const second = bytes[index + 1]
      const third = bytes[index + 2]
      result += BASE64_ALPHABET[first >> 2]
      result += BASE64_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)]
      result +=
        second === undefined ? "=" : BASE64_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)]
      result += third === undefined ? "=" : BASE64_ALPHABET[third & 63]
    }
    return result
  } catch {
    return null
  }
}

function readDataValue(value: unknown): string | null {
  try {
    if (typeof value === "string") {
      return value.length > 0 ? value : null
    }
    return value instanceof Uint8Array ? encodeBase64(value) : null
  } catch {
    return null
  }
}

function normalizeUrlSource(value: unknown, mimeType?: string): MessageAttachmentUrlSource | null {
  if (typeof value !== "string") {
    return null
  }
  const url = value.trim()
  if (!url) {
    return null
  }

  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== "https:" &&
      parsed.protocol !== "data:" &&
      parsed.protocol !== "jingle-extension-asset:"
    ) {
      return null
    }
  } catch {
    return null
  }

  return { kind: "url", ...(mimeType ? { mimeType } : {}), url }
}

function normalizeAnthropicSource(
  value: unknown,
  inheritedMimeType: string | undefined,
  allowText: boolean
): MessageFileSource | MessageImageSource | null {
  const source = readSafeDataRecord(value)
  if (!source) {
    return null
  }
  const type = readOptionalString(source, ["type", "source_type", "kind"])
  const mimeType = readOptionalString(source, ["mimeType", "mime_type", "media_type"])
  if (!type.ok || !type.value || !mimeType.ok) {
    return null
  }
  const resolvedMimeType = mimeType.value ?? inheritedMimeType

  switch (type.value) {
    case "base64":
    case "data": {
      if (!resolvedMimeType || !hasOwn(source, "data")) {
        return null
      }
      const data = readDataValue(source.data)
      return data ? { data, kind: "data", mimeType: resolvedMimeType } : null
    }
    case "url":
      return normalizeUrlSource(source.url, resolvedMimeType)
    case "id":
    case "file-id": {
      const fileId = readOptionalString(source, ["id", "fileId", "file_id"])
      return fileId.ok && fileId.value
        ? {
            fileId: fileId.value,
            kind: "file-id",
            ...(resolvedMimeType ? { mimeType: resolvedMimeType } : {})
          }
        : null
    }
    case "text": {
      if (!allowText) {
        return null
      }
      const text = readOptionalString(source, ["text"])
      return text.ok && text.value
        ? {
            kind: "text",
            ...(resolvedMimeType ? { mimeType: resolvedMimeType } : {}),
            text: text.value
          }
        : null
    }
    default:
      return null
  }
}

function normalizeAttachmentSource(
  block: SafeDataRecord,
  options: { allowText: boolean; legacyContent: boolean }
): MessageFileSource | MessageImageSource | null {
  const mimeType = readOptionalString(block, ["mimeType", "mime_type", "media_type"])
  if (!mimeType.ok) {
    return null
  }

  const sourceType = readOptionalString(block, ["source_type"])
  if (!sourceType.ok) {
    return null
  }

  const carriers = ["source", "url", "data", "fileId", "file_id"]
  if (options.legacyContent) {
    carriers.push("content")
  }
  if (!sourceType.value) {
    carriers.push("id", "text")
  }
  const presentCarriers = carriers.filter((key) => hasOwn(block, key))
  if (sourceType.value) {
    if (
      hasOwn(block, "source") ||
      hasOwn(block, "content") ||
      hasOwn(block, "fileId") ||
      hasOwn(block, "file_id")
    ) {
      return null
    }
    switch (sourceType.value) {
      case "url":
        return hasOwn(block, "url") &&
          !hasOwn(block, "data") &&
          !hasOwn(block, "id") &&
          !hasOwn(block, "text")
          ? normalizeUrlSource(block.url, mimeType.value)
          : null
      case "base64": {
        if (
          !mimeType.value ||
          !hasOwn(block, "data") ||
          hasOwn(block, "url") ||
          hasOwn(block, "id") ||
          hasOwn(block, "text")
        ) {
          return null
        }
        const data = readDataValue(block.data)
        return data ? { data, kind: "data", mimeType: mimeType.value } : null
      }
      case "id": {
        const fileId = readOptionalString(block, ["id"])
        return fileId.ok &&
          fileId.value &&
          !hasOwn(block, "url") &&
          !hasOwn(block, "data") &&
          !hasOwn(block, "text")
          ? {
              fileId: fileId.value,
              kind: "file-id",
              ...(mimeType.value ? { mimeType: mimeType.value } : {})
            }
          : null
      }
      case "text": {
        const text = readOptionalString(block, ["text"])
        return options.allowText &&
          text.ok &&
          text.value &&
          !hasOwn(block, "url") &&
          !hasOwn(block, "data") &&
          !hasOwn(block, "id")
          ? {
              kind: "text",
              ...(mimeType.value ? { mimeType: mimeType.value } : {}),
              text: text.value
            }
          : null
      }
      default:
        return null
    }
  }

  if (presentCarriers.length !== 1) {
    return null
  }
  const carrier = presentCarriers[0]
  switch (carrier) {
    case "source":
      return normalizeAnthropicSource(block.source, mimeType.value, options.allowText)
    case "url":
      return normalizeUrlSource(block.url, mimeType.value)
    case "data": {
      if (!mimeType.value) {
        return null
      }
      const data = readDataValue(block.data)
      return data ? { data, kind: "data", mimeType: mimeType.value } : null
    }
    case "fileId":
    case "file_id": {
      const fileId = readOptionalString(block, [carrier])
      return fileId.ok && fileId.value
        ? {
            fileId: fileId.value,
            kind: "file-id",
            ...(mimeType.value ? { mimeType: mimeType.value } : {})
          }
        : null
    }
    case "id": {
      const fileId = readOptionalString(block, ["id"])
      return fileId.ok && fileId.value
        ? {
            fileId: fileId.value,
            kind: "file-id",
            ...(mimeType.value ? { mimeType: mimeType.value } : {})
          }
        : null
    }
    case "text": {
      const text = readOptionalString(block, ["text"])
      return options.allowText && text.ok && text.value
        ? {
            kind: "text",
            ...(mimeType.value ? { mimeType: mimeType.value } : {}),
            text: text.value
          }
        : null
    }
    case "content": {
      const content = readOptionalString(block, ["content"])
      if (!content.ok || !content.value) {
        return null
      }
      const urlSource = normalizeUrlSource(content.value, mimeType.value)
      return (
        urlSource ??
        (options.allowText
          ? {
              kind: "text",
              ...(mimeType.value ? { mimeType: mimeType.value } : {}),
              text: content.value
            }
          : null)
      )
    }
    default:
      return null
  }
}

function normalizeTextBlock(block: SafeDataRecord): ContentBlock {
  const text = readOptionalRawString(block, ["text", "content"])
  return text.ok && text.value !== undefined
    ? { text: text.value, type: "text" }
    : createUnrenderableContentBlock("malformed", "text")
}

function normalizeReasoningBlock(
  block: SafeDataRecord,
  role: MessageContentRole,
  sourceType: "reasoning" | "thinking" | "thinking_delta"
): ContentBlock {
  if (role !== "assistant") {
    return createUnrenderableContentBlock("unsupported", sourceType)
  }
  const reasoning = readOptionalRawString(block, ["reasoning", "thinking", "text", "content"])
  const signature = readOptionalString(block, ["signature"])
  return reasoning.ok && reasoning.value !== undefined && signature.ok
    ? {
        reasoning: reasoning.value,
        ...(signature.value ? { signature: signature.value } : {}),
        type: "reasoning"
      }
    : createUnrenderableContentBlock("malformed", sourceType)
}

function normalizeImageBlock(block: SafeDataRecord): ContentBlock {
  if (hasOwn(block, "image_url")) {
    return createUnrenderableContentBlock("malformed", "image")
  }
  const name = readOptionalString(block, ["name"])
  const source = normalizeAttachmentSource(block, { allowText: false, legacyContent: true })
  return name.ok && source && source.kind !== "text"
    ? { ...(name.value ? { name: name.value } : {}), source, type: "image" }
    : createUnrenderableContentBlock("malformed", "image")
}

function normalizeImageUrlBlock(block: SafeDataRecord): ContentBlock {
  const forbidden = ["content", "data", "fileId", "file_id", "source_type", "url"]
  const hasImageUrl = hasOwn(block, "image_url")
  const hasSource = hasOwn(block, "source")
  if (forbidden.some((key) => hasOwn(block, key)) || hasImageUrl === hasSource) {
    return createUnrenderableContentBlock("malformed", "image_url")
  }
  const name = readOptionalString(block, ["name"])
  const mimeType = readOptionalString(block, ["mimeType", "mime_type", "media_type"])
  if (!name.ok || !mimeType.ok) {
    return createUnrenderableContentBlock("malformed", "image_url")
  }

  let detail: "auto" | "high" | "low" | undefined
  if (hasOwn(block, "detail")) {
    const value = block.detail
    if (value !== "auto" && value !== "high" && value !== "low") {
      return createUnrenderableContentBlock("malformed", "image_url")
    }
    detail = value
  }
  if (hasSource) {
    const source = normalizeAnthropicSource(block.source, mimeType.value, false)
    return source?.kind === "url"
      ? {
          ...(detail ? { detail } : {}),
          ...(name.value ? { name: name.value } : {}),
          source,
          type: "image_url"
        }
      : createUnrenderableContentBlock("malformed", "image_url")
  }

  let urlValue = block.image_url
  if (typeof urlValue !== "string") {
    const imageUrl = readSafeDataRecord(urlValue)
    if (!imageUrl || !hasOwn(imageUrl, "url")) {
      return createUnrenderableContentBlock("malformed", "image_url")
    }
    urlValue = imageUrl.url
    if (hasOwn(imageUrl, "detail")) {
      if (detail) {
        return createUnrenderableContentBlock("malformed", "image_url")
      }
      const value = imageUrl.detail
      if (value !== "auto" && value !== "high" && value !== "low") {
        return createUnrenderableContentBlock("malformed", "image_url")
      }
      detail = value
    }
  }
  const source = normalizeUrlSource(urlValue, mimeType.value)
  return source
    ? {
        ...(detail ? { detail } : {}),
        ...(name.value ? { name: name.value } : {}),
        source,
        type: "image_url"
      }
    : createUnrenderableContentBlock("malformed", "image_url")
}

function normalizeFileBlock(block: SafeDataRecord): ContentBlock {
  const name = readOptionalString(block, ["name"])
  const source = normalizeAttachmentSource(block, { allowText: true, legacyContent: true })
  return name.ok && name.value && source
    ? { name: name.value, source, type: "file" }
    : createUnrenderableContentBlock("malformed", "file")
}

function normalizeUnrenderableBlock(block: SafeDataRecord): ContentBlock {
  const reason = block.reason
  const sourceType = block.sourceType
  return (reason === "malformed" || reason === "unsupported") &&
    (sourceType === null || typeof sourceType === "string")
    ? createUnrenderableContentBlock(reason, sourceType)
    : createUnrenderableContentBlock("malformed", "unrenderable")
}

function normalizeToolResultBlock(
  block: SafeDataRecord,
  options: DisplayMessageContentOptions,
  ancestors: WeakSet<object>
): ContentBlock[] {
  if (options.role !== "tool" || !hasOwn(block, "content")) {
    return [createUnrenderableContentBlock("unsupported", "tool_result")]
  }

  const wrapperId = readOptionalString(block, ["tool_use_id", "tool_call_id"])
  if (!wrapperId.ok || (wrapperId.value && wrapperId.value !== options.toolCallId)) {
    return [createUnrenderableContentBlock("malformed", "tool_result")]
  }

  const nested = block.content
  if (typeof nested === "string") {
    return nested.length > 0 ? [{ text: nested, type: "text" }] : []
  }
  const nestedArray = readSafeArray(nested)
  if (!nestedArray) {
    return [createUnrenderableContentBlock("malformed", "tool_result")]
  }
  if (ancestors.has(nested as object)) {
    return [createUnrenderableContentBlock("malformed", "tool_result")]
  }
  ancestors.add(nested as object)
  const result = nestedArray.flatMap((entry) => normalizeContentBlock(entry, options, ancestors))
  ancestors.delete(nested as object)
  return result
}

function normalizeContentBlock(
  value: unknown,
  options: DisplayMessageContentOptions,
  ancestors: WeakSet<object>
): ContentBlock[] {
  const block = readSafeDataRecord(value)
  if (!block) {
    return [createUnrenderableContentBlock("malformed", null)]
  }
  const type = readOptionalString(block, ["type"])
  if (!type.ok || !type.value) {
    return [createUnrenderableContentBlock("malformed", null)]
  }

  switch (type.value) {
    case "text":
      return [normalizeTextBlock(block)]
    case "reasoning":
    case "thinking":
    case "thinking_delta":
      return [normalizeReasoningBlock(block, options.role, type.value)]
    case "image":
      return [normalizeImageBlock(block)]
    case "image_url":
      return [normalizeImageUrlBlock(block)]
    case "file":
      return [normalizeFileBlock(block)]
    case "tool_result":
      return normalizeToolResultBlock(block, options, ancestors)
    case "tool_use":
      return []
    case "unrenderable":
      return [normalizeUnrenderableBlock(block)]
    case "redacted_thinking":
    case "signature_delta":
      return []
    default:
      return [createUnrenderableContentBlock("unsupported", type.value)]
  }
}

function extractReasoningPayloadText(value: unknown, ancestors = new WeakSet<object>()): string {
  if (typeof value === "string") {
    return value
  }
  const array = readSafeArray(value)
  if (array) {
    if (ancestors.has(value as object)) {
      return ""
    }
    ancestors.add(value as object)
    const result = array.map((entry) => extractReasoningPayloadText(entry, ancestors)).join("")
    ancestors.delete(value as object)
    return result
  }
  const record = readSafeDataRecord(value)
  if (!record || ancestors.has(value as object)) {
    return ""
  }
  ancestors.add(value as object)
  for (const key of ["reasoning", "reasoning_content", "thinking", "text"]) {
    if (typeof record[key] === "string") {
      ancestors.delete(value as object)
      return record[key]
    }
  }
  const result = [record.summary, record.content]
    .map((entry) => extractReasoningPayloadText(entry, ancestors))
    .join("")
  ancestors.delete(value as object)
  return result
}

function extractAssistantReasoningText(source: AssistantMessageContentSource): string {
  for (const containerValue of [source.additional_kwargs, source.response_metadata]) {
    const container = readSafeDataRecord(containerValue)
    if (!container) {
      continue
    }
    for (const key of ["reasoning_content", "reasoning", "thinking"]) {
      const reasoning = extractReasoningPayloadText(container[key])
      if (reasoning) {
        return reasoning
      }
    }
  }
  return ""
}

export function resolveImageBlockUrl(
  block: ImageContentBlock | ImageUrlContentBlock
): string | null {
  if (block.source.kind === "url") {
    return block.source.url
  }
  if (block.source.kind === "data") {
    return `data:${block.source.mimeType};base64,${block.source.data}`
  }
  return null
}

export function toDisplayMessageContent(
  content: unknown,
  options: DisplayMessageContentOptions
): MessageContent {
  if (typeof content === "string") {
    return content
  }
  if (content === undefined || content === null) {
    return ""
  }
  const blocks = readSafeArray(content)
  if (!blocks) {
    return [createUnrenderableContentBlock("malformed", null)]
  }
  const ancestors = new WeakSet<object>()
  ancestors.add(content as object)
  return blocks.flatMap((block) => normalizeContentBlock(block, options, ancestors))
}

export function toDisplayAssistantMessageContent(
  content: string | unknown[] | AgentMessageContent | undefined,
  options: DisplayAssistantMessageContentOptions = {}
): MessageContent {
  const displayContent = toDisplayMessageContent(content, { role: "assistant" })
  const reasoning = extractAssistantReasoningText(options)
  if (typeof displayContent === "string") {
    if (!reasoning.trim()) {
      return displayContent
    }
    return [
      { reasoning, type: "reasoning" },
      ...(displayContent.length > 0 ? [{ text: displayContent, type: "text" } as const] : [])
    ]
  }
  const withReasoning =
    reasoning.trim() &&
    !displayContent.some((block) => block.type === "reasoning" && block.reasoning.trim())
      ? [{ reasoning, type: "reasoning" } satisfies ContentBlock, ...displayContent]
      : displayContent
  return withReasoning.filter((block) =>
    block.type === "reasoning"
      ? block.reasoning.trim().length > 0
      : block.type !== "text" || block.text.length > 0
  )
}

export function extractMessageText(
  content: string | ContentBlock[] | AgentMessageContent | undefined
): string {
  const displayContent = toDisplayMessageContent(content, { role: "system" })
  return typeof displayContent === "string"
    ? displayContent
    : displayContent.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
}

export function summarizeMessageContent(
  content: string | ContentBlock[] | AgentMessageContent
): string {
  const displayContent = toDisplayMessageContent(content, { role: "system" })
  const text = extractMessageText(displayContent).trim()
  if (text || !Array.isArray(displayContent)) {
    return text
  }
  const fileNames = displayContent.flatMap((block) => (block.type === "file" ? [block.name] : []))
  if (fileNames.length > 0) {
    return `Attached files: ${fileNames.join(", ")}`
  }
  const imageCount = displayContent.filter(
    (block) => block.type === "image" || block.type === "image_url"
  ).length
  return imageCount === 1 ? "Attached image" : imageCount > 1 ? `${imageCount} attached images` : ""
}

export function hasComposerMessageInputContent(input: ComposerMessageInput | undefined): boolean {
  return hasJingleAgentComposerMessageInputContent(input)
}

export function hasMessageContent(
  content: string | ContentBlock[] | AgentMessageContent | undefined
): boolean {
  const displayContent = toDisplayMessageContent(content, { role: "system" })
  if (typeof displayContent === "string") {
    return displayContent.trim().length > 0
  }
  return displayContent.some((block) =>
    block.type === "text"
      ? block.text.trim().length > 0
      : block.type === "reasoning"
        ? block.reasoning.trim().length > 0
        : true
  )
}

export function toMessageContent(input: ComposerMessageInput): MessageContent {
  return toDisplayMessageContent(buildJingleAgentDisplayMessageContent(input), { role: "user" })
}

export function toComposerMessageInput(
  content: string | ContentBlock[] | AgentMessageContent | undefined,
  metadata?: unknown
): ComposerMessageInput {
  const metadataRefs = extractComposerMessageRefsMetadata(metadata)
  const displayContent = toDisplayMessageContent(content, { role: "user" })
  if (typeof displayContent === "string") {
    return { refs: metadataRefs, text: stripSyntheticRefsText(displayContent, metadataRefs) }
  }

  const textParts: string[] = []
  const refs: ComposerMessageRef[] = []
  for (const block of displayContent) {
    switch (block.type) {
      case "text": {
        const text = stripSyntheticRefsText(block.text, metadataRefs)
        if (text.length > 0) textParts.push(text)
        break
      }
      case "image":
      case "image_url": {
        const url = resolveImageBlockUrl(block)
        if (url) refs.push({ ...(block.name ? { name: block.name } : {}), type: "image", url })
        break
      }
      case "file":
        if (block.source.kind === "text") {
          refs.push({ name: block.name, path: block.source.text, type: "file" })
        }
        break
      case "reasoning":
      case "unrenderable":
        break
    }
  }
  return { refs: metadataRefs.length > 0 ? metadataRefs : refs, text: textParts.join("") }
}

function toJingleAgentContentBlocks(
  content: MessageContent
): JingleAgentMessageContentBlock[] | string {
  if (typeof content === "string") {
    return content
  }
  return content.flatMap<JingleAgentMessageContentBlock>((block) => {
    switch (block.type) {
      case "text":
        return [{ text: block.text, type: "text" }]
      case "image": {
        const url = resolveImageBlockUrl(block)
        return url
          ? [{ content: url, ...(block.name ? { name: block.name } : {}), type: "image" }]
          : []
      }
      case "image_url": {
        const url = resolveImageBlockUrl(block)
        return url
          ? [
              {
                image_url: { ...(block.detail ? { detail: block.detail } : {}), url },
                ...(block.name ? { name: block.name } : {}),
                type: "image_url"
              }
            ]
          : []
      }
      case "file":
        return block.source.kind === "text"
          ? [{ content: block.source.text, name: block.name, type: "file" }]
          : []
      case "reasoning":
      case "unrenderable":
        return []
    }
  })
}

export function toAgentMessageContent(content: MessageContent): AgentMessageContent {
  return buildJingleAgentSubmitMessageContentWithRefs({
    content: toJingleAgentContentBlocks(content),
    refs: []
  }) as AgentMessageContent
}

export function toAgentMessageContentWithRefs(
  content: MessageContent,
  refs: ComposerMessageRef[]
): AgentMessageContent {
  return buildJingleAgentSubmitMessageContentWithRefs({
    content: toJingleAgentContentBlocks(content),
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

export function toDisplayUserMessageContent(content: unknown, metadata?: unknown): MessageContent {
  const canonical = toDisplayMessageContent(content, { role: "user" })
  const metadataRefs = extractComposerMessageRefsMetadata(metadata)

  if (metadataRefs.length === 0) {
    return canonical
  }

  const unrenderable = Array.isArray(canonical)
    ? canonical.filter((block): block is UnrenderableContentBlock => block.type === "unrenderable")
    : []
  const editable = toComposerMessageInput(canonical, metadata)
  const rebuilt = toMessageContent(editable)
  if (unrenderable.length === 0) {
    return rebuilt
  }

  return [
    ...(typeof rebuilt === "string"
      ? rebuilt.length > 0
        ? [{ text: rebuilt, type: "text" } as const]
        : []
      : rebuilt),
    ...unrenderable
  ]
}
