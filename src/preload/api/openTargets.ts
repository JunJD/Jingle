import type {
  ListOpenTargetsRequest,
  ListOpenTargetsResponse,
  OpenTargetRequest
} from "@shared/open-targets"
import { invokeIpc } from "../ipc"

export const openTargetsApi = {
  list: (request: ListOpenTargetsRequest): Promise<ListOpenTargetsResponse> => {
    return invokeIpc("openTargets:list", request)
  },
  open: (request: OpenTargetRequest): Promise<void> => {
    return invokeIpc("openTargets:open", request)
  }
}
