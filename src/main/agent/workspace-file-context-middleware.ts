import { HumanMessage, type BaseMessage } from "@langchain/core/messages"
import { createMiddleware } from "langchain"
import {
  normalizeComposerMessageRefs,
  type AgentMessageContent,
  type ComposerMessageRef
} from "@shared/message-content"
import { extractWorkspaceFileReferencePaths } from "@shared/composer-reference-uri"
import type { WorkspaceService } from "../workspace/service"

const MAX_WORKSPACE_FILE_CONTEXT_CHARS = 40_000
const MAX_WORKSPACE_FILE_CONTEXT_FILES = 5

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function getAgentMessageTextContent(content: AgentMessageContent | unknown[]): string {
  if (typeof content === "string") {
    return content
  }

  return content
    .map((block) => {
      if (typeof block !== "object" || block === null) {
        return ""
      }

      if ("type" in block && block.type === "text" && "text" in block) {
        return block.text
      }

      if ("content" in block && typeof block.content === "string") {
        return block.content
      }

      return ""
    })
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n")
}

function toAgentMessageContentFromUnknownBlocks(
  content: unknown[]
): Exclude<AgentMessageContent, string> {
  const blocks: Exclude<AgentMessageContent, string> = []

  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue
    }

    if ("type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
      blocks.push({
        text: block.text,
        type: "text"
      })
      continue
    }

    if (
      "type" in block &&
      block.type === "image_url" &&
      "image_url" in block &&
      (typeof block.image_url === "string" ||
        (typeof block.image_url === "object" && block.image_url !== null))
    ) {
      blocks.push({
        image_url: block.image_url as string | { detail?: "auto" | "high" | "low"; url: string },
        ...("mimeType" in block && typeof block.mimeType === "string"
          ? { mimeType: block.mimeType }
          : {}),
        ...("name" in block && typeof block.name === "string" ? { name: block.name } : {}),
        type: "image_url"
      })
    }
  }

  return blocks
}

function appendTextToAgentMessageContent(
  content: AgentMessageContent | unknown[],
  text: string
): AgentMessageContent {
  if (typeof content === "string") {
    return content.trim().length > 0 ? `${content}\n\n${text}` : text
  }

  return [
    ...toAgentMessageContentFromUnknownBlocks(content),
    {
      text,
      type: "text"
    }
  ]
}

function getMessageRefs(message: BaseMessage): ComposerMessageRef[] {
  return normalizeComposerMessageRefs(
    (message.additional_kwargs as { refs?: unknown } | undefined)?.refs
  )
}

function getLastHumanMessage(messages: readonly BaseMessage[]): HumanMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (HumanMessage.isInstance(message)) {
      return message
    }
  }

  return null
}

function getWorkspaceFileReferencePaths(message: HumanMessage): Set<string> {
  return extractWorkspaceFileReferencePaths(getAgentMessageTextContent(message.content))
}

async function buildWorkspaceFileContext(input: {
  message: HumanMessage
  threadId: string
  workspaceService: WorkspaceService
}): Promise<string | null> {
  const referencePaths = getWorkspaceFileReferencePaths(input.message)
  if (referencePaths.size === 0) {
    return null
  }

  const fileRefs = getMessageRefs(input.message)
    .filter((ref): ref is Extract<ComposerMessageRef, { type: "file" }> => ref.type === "file")
    .filter((ref) => !ref.path.startsWith("/"))
    .filter((ref) => referencePaths.has(ref.path))
    .slice(0, MAX_WORKSPACE_FILE_CONTEXT_FILES)

  if (fileRefs.length === 0) {
    return null
  }

  const sections: string[] = []
  for (const ref of fileRefs) {
    const result = await input.workspaceService.readFile({
      filePath: ref.path,
      threadId: input.threadId
    })
    if (!result.success) {
      sections.push(
        `<file path="${escapeXmlAttribute(ref.path)}" error="${escapeXmlAttribute(result.error)}" />`
      )
      continue
    }

    const content = result.content.slice(0, MAX_WORKSPACE_FILE_CONTEXT_CHARS)
    const truncated = result.content.length > content.length
    sections.push(
      [
        `<file path="${escapeXmlAttribute(ref.path)}"${truncated ? ` truncated="true"` : ""}>`,
        content,
        "</file>"
      ].join("\n")
    )
  }

  if (sections.length === 0) {
    return null
  }

  return ["Referenced workspace files:", ...sections].join("\n")
}

export function createWorkspaceFileContextMiddleware(options: {
  threadId: string
  workspaceService: WorkspaceService
}) {
  return createMiddleware({
    name: "WorkspaceFileContextMiddleware",
    wrapModelCall: async (request, handler) => {
      const messages = Array.isArray(request.messages) ? request.messages : []
      const message = getLastHumanMessage(messages)
      if (!message) {
        return handler(request)
      }

      const fileContext = await buildWorkspaceFileContext({
        message,
        threadId: options.threadId,
        workspaceService: options.workspaceService
      })
      if (!fileContext) {
        return handler(request)
      }

      const nextMessages = messages.map((entry) =>
        entry === message
          ? new HumanMessage({
              additional_kwargs: message.additional_kwargs,
              content: appendTextToAgentMessageContent(message.content, fileContext),
              id: message.id,
              name: message.name,
              response_metadata: message.response_metadata
            })
          : entry
      )

      return handler({
        ...request,
        messages: nextMessages
      })
    }
  })
}
