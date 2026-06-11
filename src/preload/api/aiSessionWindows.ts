import type {
  OpenPinnedAiSessionWindowParams,
  OpenPinnedAiSessionWindowResult
} from "@shared/ai-session-window"
import { invokeIpc } from "../ipc"

export const aiSessionWindowsApi = {
  openPinned: (
    params: OpenPinnedAiSessionWindowParams
  ): Promise<OpenPinnedAiSessionWindowResult> => {
    return invokeIpc("ai-session-windows:openPinned", params)
  }
}
