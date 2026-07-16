import { assistantContentPartsResultSchema } from "@shared/assistant-content-part"
import { invokeIpc } from "../ipc"

export const contentCardsApi = {
  getAssistantParts: async (input: { messageId: string; threadId: string }) =>
    assistantContentPartsResultSchema.parse(
      await invokeIpc("contentCards:getAssistantParts", input)
    )
}
