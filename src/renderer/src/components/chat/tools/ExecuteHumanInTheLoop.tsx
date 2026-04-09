import { Terminal } from "lucide-react"
import { defineHumanInTheLoop } from "./registry-core"
import { ToolApprovalActions, ToolApprovalCard } from "./shared-components"
import {
  getToolApprovalPresentationMeta,
  renderToolApprovalOverview
} from "./tool-approval-presentation"

defineHumanInTheLoop({
  icon: Terminal,
  name: "execute",
  render({ copy, rawArgs, request, respond }) {
    const approvalItem = request.review
    const meta = getToolApprovalPresentationMeta(copy, approvalItem, request.tool_call.name)

    return (
      <ToolApprovalCard
        actions={
          <ToolApprovalActions
            approveLabel={copy.toolCall.approveAndRun}
            onApprove={() => respond({ type: "approve" })}
            onReject={() => respond({ type: "reject" })}
            rejectLabel={copy.toolCall.reject}
          />
        }
        badgeLabel={copy.toolCall.approvalItem}
        subtitle={meta.subtitle}
        title={meta.title}
      >
        {renderToolApprovalOverview(copy, approvalItem, { rawArgs })}
      </ToolApprovalCard>
    )
  }
})
