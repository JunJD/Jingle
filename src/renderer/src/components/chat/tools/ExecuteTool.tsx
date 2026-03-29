import { Terminal } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getCommandArg, joinSummaryParts, truncateMiddle } from "./shared"

defineToolComponent({
  name: "execute",
  icon: Terminal,
  renderSummary({ copy, args, status }) {
    const command = getCommandArg(args)
    const statusLabel =
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : null

    return joinSummaryParts(
      copy.toolCall.labels.execute,
      command ? truncateMiddle(command, 60) : null,
      statusLabel
    )
  },
  renderDetail({ args, rawResult }) {
    const command = getCommandArg(args)
    const output = rawResult

    if (!command && !output) {
      return null
    }

    return (
      <ToolDetailStack>
        {command ? <ToolCodeBlock>{`$ ${command}`}</ToolCodeBlock> : null}
        {output ? <ToolCodeBlock>{output}</ToolCodeBlock> : null}
      </ToolDetailStack>
    )
  }
})
