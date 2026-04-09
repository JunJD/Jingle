import { Edit } from "lucide-react"
import { ToolCodeBlock, ToolApprovalActions, ToolApprovalCard } from "./shared-components"
import { defineHumanInTheLoop } from "./registry-core"
import { renderFileMutationApprovalDetail } from "./file-mutation-presentation"
import { getToolApprovalPresentationMeta } from "./tool-approval-presentation"
import { isFileMutationToolName } from "../../../../../shared/file-mutation-review"
import type { HumanInTheLoopProps } from "./types"

function renderFileMutationApproval(props: HumanInTheLoopProps): React.JSX.Element {
  const { copy, rawArgs, request, respond } = props
  const toolName = isFileMutationToolName(request.tool_call.name)
    ? request.tool_call.name
    : "write_file"
  const approvalItem = request.review?.kind === "file_mutation" ? request.review : null
  const detail = approvalItem
    ? renderFileMutationApprovalDetail(copy, approvalItem, { rawArgs })
    : null
  const meta = getToolApprovalPresentationMeta(copy, approvalItem, toolName)

  return (
    <ToolApprovalCard
      actions={
        <ToolApprovalActions
          approveLabel={copy.toolCall.approveAndApply}
          onApprove={() => respond({ type: "approve" })}
          onReject={() => respond({ type: "reject" })}
          rejectLabel={copy.toolCall.reject}
        />
      }
      badgeLabel={copy.toolCall.approvalItem}
      subtitle={meta.subtitle}
      title={meta.title}
    >
      {detail ?? <ToolCodeBlock>{rawArgs}</ToolCodeBlock>}
    </ToolApprovalCard>
  )
}

defineHumanInTheLoop({
  icon: Edit,
  name: "edit_file",
  render: renderFileMutationApproval
})

defineHumanInTheLoop({
  icon: Edit,
  name: "write_file",
  render: renderFileMutationApproval
})
