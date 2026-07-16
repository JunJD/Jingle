import type { AssistantContentPartsResult } from "@shared/assistant-content-part"
import { getPrismaClient } from "../db/client"
import { readAssistantContentPartsProjection } from "../db/assistant-content-parts"
import { JingleIpcError } from "../ipc/error"

export class ContentCardsService {
  async getAssistantParts(input: {
    messageId: string
    threadId: string
  }): Promise<AssistantContentPartsResult> {
    const message = await getPrismaClient().message.findUnique({
      select: { role: true },
      where: { threadId_messageId: input }
    })
    if (!message) return { status: "pending-stream" }
    if (message.role !== "assistant") {
      throw new JingleIpcError({
        code: "FAILED_PRECONDITION",
        message: "Content cards require an assistant message."
      })
    }
    const projection = await readAssistantContentPartsProjection(input)
    return projection ? { projection, status: "ready" } : { status: "pending-stream" }
  }
}
