import { Edit } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { buildFileMutationSummary, renderFileMutationDetail } from "./file-mutation-presentation"
import type { ToolComponentProps } from "./types"

function hasFileMutationDetail({ fileMutation }: ToolComponentProps): boolean {
  return fileMutation?.kind === "view"
}

defineToolComponent({
  name: "edit_file",
  icon: Edit,
  hasDetail(props) {
    return hasFileMutationDetail(props)
  },
  renderDisplay(props) {
    return buildFileMutationSummary(props, "edit_file")
  },
  renderDetail({ fileMutation }) {
    return renderFileMutationDetail(fileMutation)
  }
})

defineToolComponent({
  name: "write_file",
  icon: Edit,
  hasDetail(props) {
    return hasFileMutationDetail(props)
  },
  renderDisplay(props) {
    return buildFileMutationSummary(props, "write_file")
  },
  renderDetail({ fileMutation }) {
    return renderFileMutationDetail(fileMutation)
  }
})
