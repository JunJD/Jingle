import { Edit } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { buildFileMutationSummary, renderFileMutationDetail } from "./file-mutation-presentation"

defineToolComponent({
  name: "edit_file",
  icon: Edit,
  hasDetail({ fileMutation, rawArgs, rawResult, status }) {
    return Boolean(fileMutation || rawResult || (status === "arguments_streaming" && rawArgs))
  },
  renderDisplay(props) {
    return buildFileMutationSummary(props, "edit_file")
  },
  renderDetail({ copy, fileMutation, rawArgs, rawResult, status }) {
    return renderFileMutationDetail(copy, {
      fileMutation,
      rawArgs: status === "arguments_streaming" ? rawArgs : undefined,
      rawResult
    })
  }
})

defineToolComponent({
  name: "write_file",
  icon: Edit,
  hasDetail({ fileMutation, rawArgs, rawResult, status }) {
    return Boolean(fileMutation || rawResult || (status === "arguments_streaming" && rawArgs))
  },
  renderDisplay(props) {
    return buildFileMutationSummary(props, "write_file")
  },
  renderDetail({ copy, fileMutation, rawArgs, rawResult, status }) {
    return renderFileMutationDetail(copy, {
      fileMutation,
      rawArgs: status === "arguments_streaming" ? rawArgs : undefined,
      rawResult
    })
  }
})
