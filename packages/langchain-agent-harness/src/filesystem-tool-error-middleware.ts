import { ToolMessage } from "@langchain/core/messages"
import { isGraphInterrupt } from "@langchain/langgraph"
import { createMiddleware } from "langchain"

const FILESYSTEM_TOOL_NAMES = new Set([
  "edit_file",
  "execute",
  "glob",
  "grep",
  "ls",
  "read_file",
  "write_file"
])

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createFilesystemToolErrorMiddleware() {
  return createMiddleware({
    name: "FilesystemToolErrorMiddleware",
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name

      if (!FILESYSTEM_TOOL_NAMES.has(toolName)) {
        return handler(request)
      }

      try {
        return await handler(request)
      } catch (error) {
        if (isGraphInterrupt(error)) {
          throw error
        }

        return new ToolMessage({
          content: `Tool '${toolName}' failed: ${messageFromError(error)}`,
          name: toolName,
          status: "error",
          tool_call_id: request.toolCall.id ?? ""
        })
      }
    }
  })
}
