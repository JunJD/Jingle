import { GitBranch } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { isNonEmptyString, joinSummaryParts } from "./shared"

defineToolComponent({
  name: "task",
  icon: GitBranch,
  renderSummary({ copy, args, status }) {
    const name = isNonEmptyString(args.name) ? args.name : null

    return joinSummaryParts(
      copy.toolCall.labels.task,
      name,
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : status === "error"
            ? copy.common.error
            : copy.toolCall.taskCompleted
    )
  },
  renderDetail({ args, rawResult, status }) {
    const name = isNonEmptyString(args.name) ? args.name : ""
    const description = isNonEmptyString(args.description) ? args.description : ""
    const output = status === "error" ? "" : rawResult

    if (!name && !description && !output) {
      return null
    }

    return (
      <ToolDetailStack>
        {name ? <div className="text-[13px] leading-5 text-foreground/80">{name}</div> : null}
        {description ? (
          <div className="break-all text-[12px] leading-5 text-muted-foreground">{description}</div>
        ) : null}
        {output ? <ToolCodeBlock>{output}</ToolCodeBlock> : null}
      </ToolDetailStack>
    )
  }
})
