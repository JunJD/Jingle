import {
  assistantContentProjectionChangedEventSchema,
  assistantContentProjectionInspectionListSchema,
  assistantContentPartsResultSchema,
  type AssistantContentProjectionChangedEvent
} from "@shared/assistant-content-part"
import { invokeIpc, ipcRenderer } from "../ipc"

export const contentCardsApi = {
  onChanged: (listener: (event: AssistantContentProjectionChangedEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => {
      const parsed = assistantContentProjectionChangedEventSchema.safeParse(payload)
      if (!parsed.success) {
        console.error("[ContentCards] Ignored an invalid projection change event.")
        return
      }
      listener(parsed.data)
    }
    ipcRenderer.on("contentCards:changed", handler)
    return () => ipcRenderer.removeListener("contentCards:changed", handler)
  },
  inspectAssistantParts: async (input: { messageIds: string[]; threadId: string }) =>
    assistantContentProjectionInspectionListSchema.parse(
      await invokeIpc("contentCards:inspectAssistantParts", input)
    ),
  getAssistantParts: async (input: { messageId: string; threadId: string }) =>
    assistantContentPartsResultSchema.parse(
      await invokeIpc("contentCards:getAssistantParts", input)
    )
}
