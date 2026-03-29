import { FileText } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack, ToolPreviewLines } from "./shared-components"
import { getBasename, getPathArg, joinSummaryParts } from "./shared"

defineToolComponent({
  name: "read_file",
  icon: FileText,
  renderSummary({ copy, args, status }) {
    const path = getPathArg(args)
    const target = path ? getBasename(path) : copy.toolCall.labels.read_file

    return joinSummaryParts(
      copy.toolCall.labels.read_file,
      target,
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : null
    )
  },
  renderDetail({ args, rawResult }) {
    const path = getPathArg(args)
    const content = rawResult

    if (!path && !content) {
      return null
    }

    return (
      <ToolDetailStack>
        {path ? <ToolCodeBlock>{path}</ToolCodeBlock> : null}
        {content ? <ToolPreviewLines text={content} /> : null}
      </ToolDetailStack>
    )
  }
})
