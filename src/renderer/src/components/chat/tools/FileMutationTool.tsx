import { Edit } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { buildFileMutationSummary, renderFileMutationDetail } from "./file-mutation-presentation"

defineToolComponent({
  name: "edit_file",
  icon: Edit,
  renderSummary(props) {
    return buildFileMutationSummary(props, "edit_file")
  },
  renderDetail({ copy, args, rawResult }) {
    return renderFileMutationDetail(copy, args, "edit_file", { rawResult })
  }
})

defineToolComponent({
  name: "write_file",
  icon: Edit,
  renderSummary(props) {
    return buildFileMutationSummary(props, "write_file")
  },
  renderDetail({ copy, args, rawResult }) {
    return renderFileMutationDetail(copy, args, "write_file", { rawResult })
  }
})
