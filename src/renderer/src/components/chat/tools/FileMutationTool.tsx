import { Edit } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { buildFileMutationSummary, renderFileMutationDetail } from "./file-mutation-presentation"

defineToolComponent({
  name: "edit_file",
  icon: Edit,
  renderDisplay(props) {
    return buildFileMutationSummary(props, "edit_file")
  },
  renderDetail({ copy, args, rawResult, status }) {
    return renderFileMutationDetail(copy, args, "edit_file", {
      changesLabel: status === "complete" ? copy.toolCall.appliedChanges : undefined,
      rawResult
    })
  }
})

defineToolComponent({
  name: "write_file",
  icon: Edit,
  renderDisplay(props) {
    return buildFileMutationSummary(props, "write_file")
  },
  renderDetail({ copy, args, rawResult, status }) {
    return renderFileMutationDetail(copy, args, "write_file", {
      changesLabel: status === "complete" ? copy.toolCall.appliedChanges : undefined,
      rawResult
    })
  }
})
