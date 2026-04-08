import type { ContentBlock } from "./app-types"

export type AgentMessageContent =
  | string
  | Array<
      | {
          text: string
          type: "text"
        }
      | {
          image_url: string | { detail?: "auto" | "high" | "low"; url: string }
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

export interface ComposerMessageInput {
  refs: ComposerMessageRef[]
  text: string
}

export interface AgentInvokeMessage {
  additional_kwargs?: {
    refs?: ComposerMessageRef[]
  }
  content: AgentMessageContent
  id: string
}

function normalizeComposerMessageRef(value: unknown): ComposerMessageRef | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const ref = value as {
    name?: unknown
    path?: unknown
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
  const fileNames = refs
    .filter((ref): ref is Extract<ComposerMessageRef, { type: "file" }> => ref.type === "file")
    .map((ref) => ref.name.trim())
    .filter(Boolean)

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
  content: string | ContentBlock[] | AgentMessageContent | undefined
): string | ContentBlock[] {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content.filter(isContentBlockLike)
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
  if (!input) {
    return false
  }

  if (input.text.trim().length > 0) {
    return true
  }

  return input.refs.some((ref) => {
    switch (ref.type) {
      case "file":
        return ref.path.trim().length > 0
      case "image":
        return ref.url.trim().length > 0
      default:
        return false
    }
  })
}

export function hasMessageContent(
  content: string | ContentBlock[] | AgentMessageContent | undefined
): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false
  }

  return content.some((block) => {
    if (typeof block !== "object" || block === null || !("type" in block)) {
      return false
    }

    if (block.type === "text") {
      return typeof block.text === "string" && block.text.trim().length > 0
    }

    if (block.type === "image" || block.type === "image_url") {
      return Boolean(resolveImageBlockUrl(block as Pick<ContentBlock, "content" | "image_url">))
    }

    if (block.type === "file") {
      return (
        ("name" in block && typeof block.name === "string" && block.name.length > 0) ||
        ("content" in block && typeof block.content === "string" && block.content.length > 0)
      )
    }

    return getDisplayBlockText(block as ContentBlock).trim().length > 0
  })
}

export function toMessageContent(input: ComposerMessageInput): string | ContentBlock[] {
  if (input.refs.length === 0) {
    return input.text
  }

  const blocks: ContentBlock[] = []

  if (input.text.trim().length > 0) {
    blocks.push({
      text: input.text,
      type: "text"
    })
  }

  for (const ref of input.refs) {
    switch (ref.type) {
      case "file":
        blocks.push({
          content: ref.path,
          name: ref.name,
          type: "file"
        })
        break
      case "image":
        blocks.push({
          content: ref.url,
          ...(ref.name ? { name: ref.name } : {}),
          type: "image"
        })
        break
    }
  }

  return blocks
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
  if (typeof content === "string") {
    return content
  }

  const agentBlocks: Array<
    { text: string; type: "text" } | { image_url: { url: string }; type: "image_url" }
  > = []
  const fileNames: string[] = []

  for (const block of content) {
    switch (block.type) {
      case "text": {
        const text = (block.text ?? "").trim()
        if (text) {
          agentBlocks.push({
            text,
            type: "text"
          })
        }
        break
      }
      case "image":
      case "image_url": {
        const url = resolveImageBlockUrl(block)
        if (url) {
          agentBlocks.push({
            image_url: { url },
            type: "image_url"
          })
        }
        break
      }
      case "file": {
        const name = (block.name ?? block.content ?? "").trim()
        if (name) {
          fileNames.push(name)
        }
        break
      }
      default: {
        const text = getDisplayBlockText(block).trim()
        if (text) {
          agentBlocks.push({
            text,
            type: "text"
          })
        }
      }
    }
  }

  if (fileNames.length > 0) {
    agentBlocks.push({
      text: `Attached files:\n${fileNames.map((name) => `- ${name}`).join("\n")}`,
      type: "text"
    })
  }

  if (agentBlocks.length === 1 && agentBlocks[0]?.type === "text") {
    return agentBlocks[0].text
  }

  return agentBlocks
}

export function toDisplayUserMessageContent(
  content: string | ContentBlock[] | AgentMessageContent | undefined,
  metadata?: unknown
): string | ContentBlock[] {
  return toMessageContent(toComposerMessageInput(content, metadata))
}
