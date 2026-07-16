import { Search } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolContractNotice, ToolDetailStack, ToolDetailText } from "./shared-components"
import { projectRequiredStringArg } from "./shared"

defineToolComponent({
  name: "grep",
  icon: Search,
  project({ args, rawResult, status }) {
    return {
      pattern: projectRequiredStringArg(args, "pattern", status === "arguments_streaming"),
      resultText: rawResult
    }
  },
  hasDetail({ viewModel }) {
    return viewModel.pattern.kind === "invalid" || Boolean(viewModel.resultText)
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.pattern.kind === "ready" ? viewModel.pattern.value : null,
      title: copy.toolCall.labels.grep
    }
  },
  renderDetail({ copy, viewModel }) {
    return (
      <ToolDetailStack>
        {viewModel.pattern.kind === "invalid" ? (
          <ToolContractNotice copy={copy} field={viewModel.pattern.field} />
        ) : null}
        {viewModel.resultText ? <ToolDetailText>{viewModel.resultText}</ToolDetailText> : null}
      </ToolDetailStack>
    )
  }
})
