import { FileViewer } from "@/components/tabs/FileViewer"
import type { FileArtifactRecord, ManagedPatchArtifactRecord } from "@shared/artifacts"

interface FileArtifactPreviewProps {
  artifact: FileArtifactRecord | ManagedPatchArtifactRecord
}

export function FileArtifactPreview(props: FileArtifactPreviewProps): React.JSX.Element {
  const { artifact } = props

  return (
    <FileViewer
      artifactId={artifact.id}
      filePath={artifact.source.uri}
      source="artifact"
      versionToken={artifact.updatedAt.toISOString()}
    />
  )
}
