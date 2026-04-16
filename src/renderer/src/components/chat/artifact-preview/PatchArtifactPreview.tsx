import { ScrollArea } from "@/components/ui/scroll-area"
import { CodeBlock } from "@/components/ui/code-block"
import type { InlinePatchArtifactRecord } from "@shared/artifacts"

interface PatchArtifactPreviewProps {
  artifact: InlinePatchArtifactRecord
}

export function PatchArtifactPreview(props: PatchArtifactPreviewProps): React.JSX.Element {
  const { artifact } = props

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <CodeBlock
          className="min-h-full"
          code={artifact.payload.text}
          filename={artifact.title}
          language="diff"
          maxLines={undefined}
        />
      </div>
    </ScrollArea>
  )
}
