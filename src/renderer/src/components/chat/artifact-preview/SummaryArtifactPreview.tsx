import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageResponse } from "../message"
import type { SummaryArtifactRecord } from "@shared/artifacts"

interface SummaryArtifactPreviewProps {
  artifact: SummaryArtifactRecord
}

export function SummaryArtifactPreview(props: SummaryArtifactPreviewProps): React.JSX.Element {
  const { artifact } = props

  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {artifact.payload.format === "markdown" ? (
          <MessageResponse className="min-w-0 text-[15px] leading-7">
            {artifact.payload.text}
          </MessageResponse>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">
            {artifact.payload.text}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
