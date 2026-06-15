import { lazy, Suspense } from "react"
import type React from "react"
import type { FileMutationViewModel } from "./file-mutation-view-model"

interface PierreFileMutationViewProps {
  className?: string
  compact?: boolean
  viewModel: FileMutationViewModel
}

const PierreFileMutationRenderer = lazy(() =>
  import("./PierreFileMutationRenderer").then((module) => ({
    default: module.PierreFileMutationRenderer
  }))
)

export function PierreFileMutationView(
  props: PierreFileMutationViewProps
): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <PierreFileMutationRenderer {...props} />
    </Suspense>
  )
}
