import { invokeIpc } from "../ipc"

type WorkspaceFileReadResult = {
  success: boolean
  content?: string
  size?: number
  modified_at?: string
  error?: string
}

type WorkspaceFileSearchResult = {
  success: boolean
  files?: Array<{
    name: string
    path: string
  }>
  incomplete?: true
  error?: string
}

type WorkspaceCreateDefaultParams = {
  title?: string
}

export const workspaceApi = {
  get: (threadId?: string): Promise<string | null> => {
    return invokeIpc("workspace:get", threadId)
  },
  set: (threadId: string | undefined, path: string | null): Promise<string | null> => {
    return invokeIpc("workspace:set", { threadId, path })
  },
  select: (threadId?: string): Promise<string | null> => {
    return invokeIpc("workspace:select", threadId)
  },
  selectFolder: (): Promise<string | null> => {
    return invokeIpc("workspace:selectFolder")
  },
  createDefault: (params: WorkspaceCreateDefaultParams = {}): Promise<string> => {
    return invokeIpc("workspace:createDefault", params)
  },
  readFile: (threadId: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    return invokeIpc("workspace:readFile", { threadId, filePath })
  },
  readBinaryFile: (threadId: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    return invokeIpc("workspace:readBinaryFile", { threadId, filePath })
  },
  searchFiles: (
    threadId: string | undefined,
    query: string,
    limit?: number
  ): Promise<WorkspaceFileSearchResult> => {
    return invokeIpc("workspace:searchFiles", { threadId, query, limit })
  }
}
