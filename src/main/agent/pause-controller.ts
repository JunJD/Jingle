import type { RuntimePauseController } from "@jingle/langchain-agent-harness"
import type { JingleHitlRequest } from "@jingle/langchain-agent-harness/transitional"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { parseToolApprovalItem } from "@shared/tool-approval"
import { upsertHitlRequest } from "../db/hitl"

export type JingleRuntimePauseController = RuntimePauseController<ToolApprovalItem>

export function createRuntimePauseController(): JingleRuntimePauseController {
  return {
    parseReview: parseToolApprovalItem,
    upsertPendingHitlRequest
  }
}

async function upsertPendingHitlRequest(
  request: JingleHitlRequest<ToolApprovalItem>,
  context: { runId: string | null; threadId: string }
): Promise<void> {
  await upsertHitlRequest({
    request_id: request.id,
    thread_id: context.threadId,
    run_id: context.runId,
    tool_call_id: request.tool_call.id,
    tool_name: request.tool_call.name,
    tool_args: request.tool_call.args,
    review_kind: request.review?.kind ?? null,
    review_payload: request.review,
    allowed_decisions: request.allowed_decisions,
    status: "pending"
  })
}
