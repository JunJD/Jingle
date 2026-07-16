import { Terminal } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolContractNotice, ToolDetailStack } from "./shared-components"
import { projectRequiredStringArg, truncateMiddle } from "./shared"

defineToolComponent({
  name: "execute",
  icon: Terminal,
  project({ args, rawResult, status }) {
    const command = projectRequiredStringArg(args, "command", status === "arguments_streaming")
    return {
      command,
      detail: command.kind === "ready" ? truncateMiddle(command.value, 60) : null,
      output: rawResult
    }
  },
  hasDetail({ viewModel }) {
    return (
      viewModel.command.kind === "invalid" ||
      Boolean(viewModel.command.kind === "ready" && viewModel.command.value) ||
      Boolean(viewModel.output)
    )
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.execute
    }
  },
  renderDetail({ copy, viewModel }) {
    return (
      <ToolDetailStack>
        {viewModel.command.kind === "invalid" ? (
          <ToolContractNotice copy={copy} field={viewModel.command.field} />
        ) : viewModel.command.kind === "ready" ? (
          <ToolCodeBlock>{`$ ${viewModel.command.value}`}</ToolCodeBlock>
        ) : null}
        {viewModel.output ? <ToolCodeBlock>{viewModel.output}</ToolCodeBlock> : null}
      </ToolDetailStack>
    )
  }
})
