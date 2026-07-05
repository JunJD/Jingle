import type {
  ArtifactActionId,
  ArtifactActionResolution,
  ArtifactChangedEvent,
  ArtifactRecord
} from "@shared/artifacts"
import { invokeIpc, ipcRenderer } from "../ipc"

type ArtifactFileReadResult = {
  success: boolean
  content?: string
  size?: number
  modified_at?: string
  error?: string
}

export const artifactsApi = {
  list: (threadId: string): Promise<ArtifactRecord[]> => {
    return invokeIpc("artifacts:list", threadId)
  },
  open: (artifactId: string, action?: ArtifactActionId): Promise<ArtifactActionResolution> => {
    return invokeIpc("artifacts:open", { action, artifactId })
  },
  readFile: (artifactId: string): Promise<ArtifactFileReadResult> => {
    return invokeIpc("artifacts:readFile", artifactId)
  },
  readBinaryFile: (artifactId: string): Promise<ArtifactFileReadResult> => {
    return invokeIpc("artifacts:readBinaryFile", artifactId)
  },
  onChanged: (callback: (event: ArtifactChangedEvent) => void) => {
    const listener = (_event: unknown, payload: ArtifactChangedEvent): void => {
      callback(payload)
    }

    ipcRenderer.on("artifacts:changed", listener)
    return () => {
      ipcRenderer.removeListener("artifacts:changed", listener)
    }
  }
}
