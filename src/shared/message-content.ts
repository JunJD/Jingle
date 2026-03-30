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

      if ("content" in block && typeof block.content === "string") {
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
