import { Edit } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import {
  buildFileMutationSummary,
  projectFileMutationTool,
  renderFileMutationDetail,
  type FileMutationToolViewModel
} from "./file-mutation-presentation"

function hasFileMutationDetail(viewModel: FileMutationToolViewModel): boolean {
  return viewModel.fileMutation?.kind === "view" || viewModel.fileMutation?.kind === "invalid"
}

defineToolComponent({
  name: "edit_file",
  icon: Edit,
  project(input) {
    return projectFileMutationTool(input, "edit_file")
  },
  hasDetail({ viewModel }) {
    return hasFileMutationDetail(viewModel)
  },
  renderDisplay({ copy, viewModel }) {
    return buildFileMutationSummary(copy, viewModel, "edit_file")
  },
  renderDetail({ copy, viewModel }) {
    return renderFileMutationDetail(copy, viewModel.fileMutation)
  }
})

defineToolComponent({
  name: "write_file",
  icon: Edit,
  project(input) {
    return projectFileMutationTool(input, "write_file")
  },
  hasDetail({ viewModel }) {
    return hasFileMutationDetail(viewModel)
  },
  renderDisplay({ copy, viewModel }) {
    return buildFileMutationSummary(copy, viewModel, "write_file")
  },
  renderDetail({ copy, viewModel }) {
    return renderFileMutationDetail(copy, viewModel.fileMutation)
  }
})
