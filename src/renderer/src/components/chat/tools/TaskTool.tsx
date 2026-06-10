import { GitBranch } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { isNonEmptyString } from "./shared"

defineToolComponent({
  name: "task",
  icon: GitBranch,
  renderDisplay({ copy, args }) {
    const name = isNonEmptyString(args.name) ? args.name : null

    return {
      detail: name,
      title: copy.toolCall.labels.task
    }
  },
  renderDetail({ args, rawResult }) {
    const name = isNonEmptyString(args.name) ? args.name : ""
    const description = isNonEmptyString(args.description) ? args.description : ""
    const output = rawResult

    if (!name && !description && !output) {
      return null
    }

    return (
      <ToolDetailStack>
        {name ? (
          <div className="[font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)] text-foreground/80">
            {name}
          </div>
        ) : null}
        {description ? (
          <div className="break-all [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
            {description}
          </div>
        ) : null}
        {output ? <ToolCodeBlock>{output}</ToolCodeBlock> : null}
      </ToolDetailStack>
    )
  }
})
