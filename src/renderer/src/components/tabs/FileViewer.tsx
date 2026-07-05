import { useEffect, useMemo, useState } from "react"
import { Loader2, AlertCircle, FileCode } from "lucide-react"
import { useThreadControl, useThreadSelector, type ThreadControl } from "@/lib/thread-context"
import { getFileType, isBinaryFile } from "@/lib/file-types"
import { CodeViewer } from "./CodeViewer"
import { ImageViewer } from "./ImageViewer"
import { MediaViewer } from "./MediaViewer"
import { PDFViewer } from "./PDFViewer"
import { BinaryFileViewer } from "./BinaryFileViewer"
import { MarkdownViewer } from "./MarkdownViewer"

type WorkspaceFileViewerProps = {
  filePath: string
  source?: "workspace"
  threadId: string
  versionToken?: string
}

type ArtifactFileViewerProps = {
  artifactId: string
  filePath: string
  source: "artifact"
  versionToken?: string
}

type FileViewerProps = WorkspaceFileViewerProps | ArtifactFileViewerProps

type FileViewerContentRequest =
  | {
      filePath: string
      key: string
      source: "workspace"
      threadId: string
    }
  | {
      artifactId: string
      filePath: string
      key: string
      source: "artifact"
    }

interface LocalFileContentState {
  binaryContent: string | null
  error: string | null
  fileSize: number | undefined
  key: string
  textContent: string | undefined
}

const READ_FILE_ERROR_MESSAGE = "Failed to read file"

function createFileViewerContentRequest(props: FileViewerProps): FileViewerContentRequest {
  const versionSegment = props.versionToken ? `:${props.versionToken}` : ""

  if (props.source === "artifact") {
    return {
      artifactId: props.artifactId,
      filePath: props.filePath,
      key: `artifact:${props.artifactId}:${props.filePath}${versionSegment}`,
      source: "artifact"
    }
  }

  return {
    filePath: props.filePath,
    key: `workspace:${props.threadId}:${props.filePath}${versionSegment}`,
    source: "workspace",
    threadId: props.threadId
  }
}

function getReadFileErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return READ_FILE_ERROR_MESSAGE
}

function setWorkspaceFileContents(
  threadControl: ThreadControl | null,
  filePath: string,
  content: string
): void {
  if (!threadControl) {
    throw new Error("Workspace file viewer requires a thread control")
  }

  threadControl.local.setFileContents(filePath, content)
}

export function FileViewer(props: FileViewerProps): React.JSX.Element | null {
  const { filePath, source, versionToken } = props
  const artifactId = source === "artifact" ? props.artifactId : null
  const threadId = source === "artifact" ? null : props.threadId
  const [isLoading, setIsLoading] = useState(false)
  const [localContentState, setLocalContentState] = useState<LocalFileContentState | null>(null)
  const contentRequest = useMemo(
    () =>
      source === "artifact"
        ? createFileViewerContentRequest({
            artifactId: artifactId as string,
            filePath,
            source,
            versionToken
          })
        : createFileViewerContentRequest({
            filePath,
            source,
            threadId: threadId as string,
            versionToken
          }),
    [artifactId, filePath, source, threadId, versionToken]
  )
  const workspaceThreadId =
    contentRequest.source === "workspace" ? contentRequest.threadId : null
  const threadControl = useThreadControl(workspaceThreadId)
  const workspaceContent = useThreadSelector(workspaceThreadId, (state) => state?.ui.fileContents[filePath])

  // Get file type info
  const fileName = filePath.split("/").pop() || filePath
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined
  const fileTypeInfo = useMemo(() => getFileType(fileName), [fileName])
  const isBinary = useMemo(() => isBinaryFile(fileName), [fileName])
  const isMarkdownDocument = ext === "md" || ext === "mdx" || ext === "markdown"

  const currentLocalContentState =
    localContentState?.key === contentRequest.key ? localContentState : null
  const textContent = currentLocalContentState?.textContent
  const binaryContent = currentLocalContentState?.binaryContent ?? null
  const error = currentLocalContentState?.error ?? null
  const fileSize = currentLocalContentState?.fileSize
  const content = contentRequest.source === "workspace" ? workspaceContent : textContent

  // Load file content (text or binary depending on file type)
  useEffect(() => {
    async function loadFile(): Promise<void> {
      // Skip if already loaded
      if (content !== undefined || binaryContent !== null) {
        return
      }

      setIsLoading(true)
      setLocalContentState(null)

      try {
        if (isBinary) {
          const result =
            contentRequest.source === "artifact"
              ? await window.api.artifacts.readBinaryFile(contentRequest.artifactId)
              : await window.api.workspace.readBinaryFile(contentRequest.threadId, filePath)
          if (result.success && result.content !== undefined) {
            setLocalContentState({
              binaryContent: result.content,
              error: null,
              fileSize: result.size,
              key: contentRequest.key,
              textContent: undefined
            })
          } else {
            setLocalContentState({
              binaryContent: null,
              error: getReadFileErrorMessage(result.error),
              fileSize: undefined,
              key: contentRequest.key,
              textContent: undefined
            })
          }
        } else {
          const result =
            contentRequest.source === "artifact"
              ? await window.api.artifacts.readFile(contentRequest.artifactId)
              : await window.api.workspace.readFile(contentRequest.threadId, filePath)
          if (result.success && result.content !== undefined) {
            if (contentRequest.source === "artifact") {
              setLocalContentState({
                binaryContent: null,
                error: null,
                fileSize: result.size,
                key: contentRequest.key,
                textContent: result.content
              })
            } else {
              setWorkspaceFileContents(threadControl, filePath, result.content)
              setLocalContentState({
                binaryContent: null,
                error: null,
                fileSize: result.size,
                key: contentRequest.key,
                textContent: undefined
              })
            }
          } else {
            setLocalContentState({
              binaryContent: null,
              error: getReadFileErrorMessage(result.error),
              fileSize: undefined,
              key: contentRequest.key,
              textContent: undefined
            })
          }
        }
      } catch (e) {
        setLocalContentState({
          binaryContent: null,
          error: getReadFileErrorMessage(e),
          fileSize: undefined,
          key: contentRequest.key,
          textContent: undefined
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadFile()
  }, [
    binaryContent,
    content,
    contentRequest,
    filePath,
    isBinary,
    threadControl,
  ])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin mr-2" />
        <span>Loading file...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3 p-8">
        <AlertCircle className="size-10 text-status-critical" />
        <div className="text-center">
          <div className="font-medium text-foreground mb-1">Failed to load file</div>
          <div className="text-sm">{error}</div>
        </div>
      </div>
    )
  }

  if (content === undefined && binaryContent === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <FileCode className="size-6 mr-2" />
        <span>No content</span>
      </div>
    )
  }

  // Route to appropriate viewer based on file type
  if (fileTypeInfo.type === "image" && binaryContent) {
    return (
      <ImageViewer
        filePath={filePath}
        base64Content={binaryContent}
        mimeType={fileTypeInfo.mimeType}
      />
    )
  }

  if (fileTypeInfo.type === "video" && binaryContent) {
    return (
      <MediaViewer
        filePath={filePath}
        base64Content={binaryContent}
        mimeType={fileTypeInfo.mimeType}
        mediaType="video"
      />
    )
  }

  if (fileTypeInfo.type === "audio" && binaryContent) {
    return (
      <MediaViewer
        filePath={filePath}
        base64Content={binaryContent}
        mimeType={fileTypeInfo.mimeType}
        mediaType="audio"
      />
    )
  }

  if (fileTypeInfo.type === "pdf" && binaryContent) {
    return <PDFViewer filePath={filePath} base64Content={binaryContent} />
  }

  if (fileTypeInfo.type === "binary") {
    return <BinaryFileViewer filePath={filePath} size={fileSize} />
  }

  if (isMarkdownDocument && content !== undefined) {
    return <MarkdownViewer filePath={filePath} content={content} />
  }

  // Default to code/text viewer
  if (content !== undefined) {
    return <CodeViewer filePath={filePath} content={content} />
  }

  return null
}
