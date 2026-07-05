import type {
  OpenPinnedAiSessionWindowParams,
  OpenPinnedAiSessionWindowResult,
  UpdatePinnedAiSessionWindowThreadParams,
  UpdatePinnedAiSessionWindowThreadResult
} from "@shared/ai-session-window"
import { invokeIpc } from "../ipc"

export const aiSessionWindowsApi = {
  openPinned: (
    params: OpenPinnedAiSessionWindowParams
  ): Promise<OpenPinnedAiSessionWindowResult> => {
    return invokeIpc("ai-session-windows:openPinned", params)
  },
  updatePinnedThread: (
    params: UpdatePinnedAiSessionWindowThreadParams
  ): Promise<UpdatePinnedAiSessionWindowThreadResult> => {
    return invokeIpc("ai-session-windows:updatePinnedThread", params)
  }
}
