import type { RuntimePauseController } from "@jingle/langchain-agent-harness"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { parseToolApprovalItem } from "@shared/tool-approval"

export type JingleRuntimePauseController = RuntimePauseController<ToolApprovalItem>

export function createRuntimePauseController(): JingleRuntimePauseController {
  return {
    parseReview: parseToolApprovalItem
  }
}
