import {
  type CreateJingleWorkspaceFileContextMiddlewareOptions,
  type JingleWorkspaceFileContextRequest
} from "@jingle/langchain-agent-harness/transitional"
import { normalizeComposerMessageRefs, type ComposerMessageRef } from "@shared/message-content"
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

async function buildWorkspaceFileContext(input: {
  request: JingleWorkspaceFileContextRequest
  threadId: string
  workspaceService: WorkspaceService
}): Promise<string | null> {
  const referencePaths = extractWorkspaceFileReferencePaths(input.request.messageText)
  if (referencePaths.size === 0) {
    return null
  }

  const fileRefs: Array<Extract<ComposerMessageRef, { type: "file" }>> = []
  for (const ref of normalizeComposerMessageRefs(input.request.messageRefs)) {
    if (ref.type !== "file" || ref.path.startsWith("/") || !referencePaths.has(ref.path)) {
      continue
    }

    fileRefs.push(ref)
    if (fileRefs.length >= MAX_WORKSPACE_FILE_CONTEXT_FILES) {
      break
    }
  }

  if (fileRefs.length === 0) {
    return null
  }

  const readResults = await Promise.all(
    fileRefs.map((ref) =>
      input.workspaceService.readFile({
        filePath: ref.path,
        threadId: input.threadId
      })
    )
  )
  const sections = fileRefs.map((ref, index) => {
    const result = readResults[index]
    if (!result) {
      throw new Error(`Missing workspace file read result for "${ref.path}".`)
    }

    if (!result.success) {
      return `<file path="${escapeXmlAttribute(ref.path)}" error="${escapeXmlAttribute(result.error)}" />`
    }

    const content = result.content.slice(0, MAX_WORKSPACE_FILE_CONTEXT_CHARS)
    const truncated = result.content.length > content.length
    return [
      `<file path="${escapeXmlAttribute(ref.path)}"${truncated ? ` truncated="true"` : ""}>`,
      content,
      "</file>"
    ].join("\n")
  })

  if (sections.length === 0) {
    return null
  }

  return ["Referenced workspace files:", ...sections].join("\n")
}

export function createWorkspaceFileContextResolver(options: {
  threadId: string
  workspaceService: WorkspaceService
}): CreateJingleWorkspaceFileContextMiddlewareOptions["resolveContext"] {
  return (request) =>
    buildWorkspaceFileContext({
      request,
      threadId: options.threadId,
      workspaceService: options.workspaceService
    })
}
