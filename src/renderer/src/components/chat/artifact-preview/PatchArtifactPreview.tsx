import { useMemo } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { InlinePatchArtifactRecord } from "@shared/artifacts"
import { PierreFileMutationView } from "../tools/PierreFileMutationView"
import { buildPatchArtifactFileMutationViewModel } from "../tools/file-mutation-view-model"

interface PatchArtifactPreviewProps {
  artifact: InlinePatchArtifactRecord
}

export function PatchArtifactPreview(props: PatchArtifactPreviewProps): React.JSX.Element {
  const { artifact } = props
  const viewModel = useMemo(
    () =>
      buildPatchArtifactFileMutationViewModel({
        patchText: artifact.payload.text,
        title: artifact.title
      }),
    [artifact.payload.text, artifact.title]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-[var(--ow-space-4)] py-[var(--ow-space-4)]">
          <PierreFileMutationView viewModel={viewModel} />
        </div>
      </ScrollArea>
    </div>
  )
}
