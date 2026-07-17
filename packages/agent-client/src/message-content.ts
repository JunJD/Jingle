export type JingleAgentMessageContent =
  | string
  | Array<
      | {
          text: string
          type: "text"
        }
      | {
          image_url: string | { detail?: "auto" | "high" | "low"; url: string }
          mimeType?: string
          name?: string
          type: "image_url"
        }
      | {
          data: string
          metadata?: { filename: string }
          mimeType: string
          name: string
          type: "file"
        }
      | {
          fileId: string
          metadata?: { filename: string }
          mimeType?: string
          name: string
          type: "file"
        }
      | {
          metadata?: { filename: string }
          mimeType?: string
          name: string
          type: "file"
          url: string
        }
    >

export type JingleAgentMessageFileSource =
  | { data: string; kind: "data"; mimeType: string }
  | { fileId: string; kind: "file-id"; mimeType?: string }
  | { kind: "text"; mimeType?: string; text: string }
  | { kind: "url"; mimeType?: string; url: string }

export interface JingleAgentMessageContentBlock {
  content?: string
  data?: string
  fileId?: string
  image_url?: string | { detail?: "auto" | "high" | "low"; url: string }
  mimeType?: string
  name?: string
  source?: JingleAgentMessageFileSource
  text?: string
  type: string
  url?: string
}

export type JingleAgentComposerMessageRef =
  | {
      type: "file"
      name: string
      path: string
    }
  | {
      type: "file-attachment"
      name: string
      source: JingleAgentMessageFileSource
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

export interface JingleAgentComposerMessageInput {
  refs: JingleAgentComposerMessageRef[]
  text: string
}

export function hasJingleAgentComposerMessageInputContent(
  input: JingleAgentComposerMessageInput | undefined
): boolean {
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
      case "file-attachment":
        return ref.name.trim().length > 0
      case "image":
        return ref.url.trim().length > 0
      case "extension-source":
      case "assistant-message-selection":
        return false
    }
  })
}

export function hasJingleAgentMessageContent(
  content: JingleAgentMessageContent | JingleAgentMessageContentBlock[] | undefined
): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false
  }

  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false
    }

    if (block.type === "text") {
      return typeof block.text === "string" && block.text.trim().length > 0
    }

    if (block.type === "image" || block.type === "image_url") {
      return Boolean(resolveJingleAgentImageBlockUrl(block))
    }

    if (block.type === "file") {
      return (
        (typeof block.name === "string" && block.name.length > 0) ||
        (typeof block.content === "string" && block.content.length > 0) ||
        (typeof block.data === "string" && block.data.length > 0) ||
        (typeof block.fileId === "string" && block.fileId.length > 0) ||
        (typeof block.url === "string" && block.url.length > 0)
      )
    }

    return readJingleAgentMessageBlockText(block).trim().length > 0
  })
}

export function buildJingleAgentDisplayMessageContent(
  input: JingleAgentComposerMessageInput
): string | JingleAgentMessageContentBlock[] {
  if (input.refs.length === 0) {
    return input.text
  }

  const blocks: JingleAgentMessageContentBlock[] = []
  const inlineWorkspaceFilePaths = extractJingleWorkspaceFileReferencePaths(input.text)

  if (input.text.trim().length > 0) {
    blocks.push({
      text: input.text,
      type: "text"
    })
  }

  for (const ref of input.refs) {
    switch (ref.type) {
      case "file":
        if (inlineWorkspaceFilePaths.has(ref.path)) {
          break
        }

        blocks.push({
          content: ref.path,
          name: ref.name,
          type: "file"
        })
        break
      case "file-attachment":
        blocks.push({ name: ref.name, source: ref.source, type: "file" })
        break
      case "image":
        blocks.push({
          content: ref.url,
          ...(ref.name ? { name: ref.name } : {}),
          type: "image"
        })
        break
      case "extension-source":
      case "assistant-message-selection":
        break
    }
  }

  return blocks
}

export function buildJingleAgentSubmitMessageContentWithRefs(input: {
  content: string | JingleAgentMessageContentBlock[]
  refs: JingleAgentComposerMessageRef[]
}): JingleAgentMessageContent {
  const content = buildJingleAgentSubmitMessageContent(input.content)
  const assistantSelectionText = buildJingleAssistantSelectionRefsText(input.refs)

  if (!assistantSelectionText) {
    return content
  }

  if (typeof content === "string") {
    return content.trim().length > 0
      ? `${content}\n\n${assistantSelectionText}`
      : assistantSelectionText
  }

  return [
    ...content,
    {
      text: assistantSelectionText,
      type: "text"
    }
  ]
}

function resolveJingleAgentImageBlockUrl(
  block: Pick<JingleAgentMessageContentBlock, "content" | "image_url">
): string | null {
  if (typeof block.image_url === "string") {
    return block.image_url.trim() || null
  }

  if (
    block.image_url &&
    typeof block.image_url === "object" &&
    typeof block.image_url.url === "string"
  ) {
    return block.image_url.url.trim() || null
  }

  return block.content?.trim() || null
}

function readJingleAgentMessageBlockText(block: JingleAgentMessageContentBlock): string {
  return block.text ?? block.content ?? ""
}

function extractJingleWorkspaceFileReferencePaths(text: string): Set<string> {
  const paths = new Set<string>()
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g
  let match: RegExpExecArray | null

  while ((match = markdownLinkPattern.exec(text)) !== null) {
    const href = match[1]?.trim()
    if (href?.startsWith("/")) {
      paths.add(href)
      continue
    }

    const workspaceFilePrefix = "jingle-workspace-file://"
    if (href?.startsWith(workspaceFilePrefix)) {
      const encodedPath = href.slice(workspaceFilePrefix.length)
      try {
        const path = decodeURIComponent(encodedPath)
        if (path) {
          paths.add(path)
        }
      } catch {
        continue
      }
    }
  }

  return paths
}

function buildJingleAgentSubmitMessageContent(
  content: string | JingleAgentMessageContentBlock[]
): JingleAgentMessageContent {
  if (typeof content === "string") {
    return content
  }

  const agentBlocks: Exclude<JingleAgentMessageContent, string> = []
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
        const url = resolveJingleAgentImageBlockUrl(block)
        if (url) {
          agentBlocks.push({
            image_url: { url },
            ...(block.mimeType ? { mimeType: block.mimeType } : {}),
            ...(block.name ? { name: block.name } : {}),
            type: "image_url"
          })
        }
        break
      }
      case "file": {
        if (block.source) {
          agentBlocks.push(toJingleAgentFileContentBlock(block.name ?? "Attachment", block.source))
          break
        }

        const name = (block.name ?? block.content ?? "").trim()
        if (name) {
          fileNames.push(name)
        }
        break
      }
      default: {
        const text = readJingleAgentMessageBlockText(block).trim()
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

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let result = ""
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    result += alphabet[first >> 2]
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]
    result += second === undefined ? "=" : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
    result += third === undefined ? "=" : alphabet[third & 63]
  }
  return result
}

function toJingleAgentFileContentBlock(
  name: string,
  source: JingleAgentMessageFileSource
): Extract<Exclude<JingleAgentMessageContent, string>[number], { type: "file" }> {
  switch (source.kind) {
    case "data":
      return {
        data: source.data,
        metadata: { filename: name },
        mimeType: source.mimeType,
        name,
        type: "file"
      }
    case "file-id":
      return {
        fileId: source.fileId,
        metadata: { filename: name },
        ...(source.mimeType ? { mimeType: source.mimeType } : {}),
        name,
        type: "file"
      }
    case "url":
      return {
        metadata: { filename: name },
        ...(source.mimeType ? { mimeType: source.mimeType } : {}),
        name,
        type: "file",
        url: source.url
      }
    case "text":
      return {
        data: encodeUtf8Base64(source.text),
        metadata: { filename: name },
        mimeType: source.mimeType ?? "text/plain;charset=utf-8",
        name,
        type: "file"
      }
  }
}

function buildJingleAssistantSelectionRefsText(
  refs: JingleAgentComposerMessageRef[]
): string | null {
  const selections = refs
    .filter(
      (
        ref
      ): ref is Extract<JingleAgentComposerMessageRef, { type: "assistant-message-selection" }> =>
        ref.type === "assistant-message-selection"
    )
    .map((ref) => ref.selectedText.trim())
    .filter(Boolean)

  if (selections.length === 0) {
    return null
  }

  return `Referenced assistant selections:\n${selections
    .map((selection, index) => `${index + 1}. ${selection}`)
    .join("\n")}`
}
