import { Terminal } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getCommandArg, truncateMiddle } from "./shared"

defineToolComponent({
  name: "execute",
  icon: Terminal,
  hasDetail({ args, rawResult }) {
    return Boolean(getCommandArg(args) || rawResult)
  },
  renderDisplay({ copy, args }) {
    const command = getCommandArg(args)

    return {
      detail: command ? truncateMiddle(command, 60) : null,
      title: copy.toolCall.labels.execute
    }
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
