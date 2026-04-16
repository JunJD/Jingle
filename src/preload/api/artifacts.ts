import { ipcRenderer } from "electron"
import type {
  ArtifactActionId,
  ArtifactActionResolution,
  ArtifactChangedEvent,
  ArtifactRecord
} from "../../shared/artifacts"

type ArtifactFileReadResult = {
  success: boolean
  content?: string
  size?: number
  modified_at?: string
  error?: string
}

export const artifactsApi = {
  list: (threadId: string): Promise<ArtifactRecord[]> => {
    return ipcRenderer.invoke("artifacts:list", threadId)
  },
  open: (artifactId: string, action?: ArtifactActionId): Promise<ArtifactActionResolution> => {
    return ipcRenderer.invoke("artifacts:open", { action, artifactId })
  },
  readFile: (artifactId: string): Promise<ArtifactFileReadResult> => {
    return ipcRenderer.invoke("artifacts:readFile", artifactId)
  },
  readBinaryFile: (artifactId: string): Promise<ArtifactFileReadResult> => {
    return ipcRenderer.invoke("artifacts:readBinaryFile", artifactId)
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
