import { File, Download } from "lucide-react"
import { Button } from "@/components/ui/button"

interface BinaryFileViewerProps {
  filePath: string
  size?: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getKnownSize(size: number | undefined): number | null {
  return typeof size === "number" && size > 0 ? size : null
}

function getExtensionLabel(fileName: string): string {
  const extensionStart = fileName.lastIndexOf(".")

  if (extensionStart === -1 || extensionStart === fileName.length - 1) {
    return "FILE"
  }

  return fileName.slice(extensionStart + 1).toUpperCase()
}

function getFileMetadataLabel(ext: string, knownSize: number | null): string {
  if (knownSize === null) {
    return `${ext} file`
  }

  return `${ext} file • ${formatSize(knownSize)}`
}

export function BinaryFileViewer({ filePath, size }: BinaryFileViewerProps): React.JSX.Element {
  const fileName = filePath.split("/").pop() || filePath
  const ext = getExtensionLabel(fileName)
  const knownSize = getKnownSize(size)
  const fileMetadataLabel = getFileMetadataLabel(ext, knownSize)

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background/50 text-xs text-muted-foreground shrink-0">
        <span className="truncate">{fileName}</span>
        <span className="text-muted-foreground/50">•</span>
        <span>Binary File</span>
        {knownSize !== null ? (
          <>
            <span className="text-muted-foreground/50">•</span>
            <span>{formatSize(knownSize)}</span>
          </>
        ) : null}
      </div>

      {/* Binary file info */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="w-24 h-24 rounded-2xl bg-accent/10 flex items-center justify-center">
          <File className="size-12 text-muted-foreground/50" />
        </div>

        <div>
          <div className="font-medium text-foreground mb-1">{fileName}</div>
          <div className="text-sm text-muted-foreground mb-2">{fileMetadataLabel}</div>
          <div className="text-xs text-muted-foreground max-w-md">
            This file type cannot be previewed in the viewer. You can open it with an external
            application.
          </div>
        </div>

        <Button variant="outline" className="gap-2">
          <Download className="size-4" />
          Open Externally
        </Button>
      </div>
    </div>
  )
}
