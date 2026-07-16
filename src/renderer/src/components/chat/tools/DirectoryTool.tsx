import { FolderOpen } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolContractNotice, ToolDetailStack, ToolDetailText } from "./shared-components"
import { getBasename, getPathArg, projectRequiredStringArg } from "./shared"

defineToolComponent({
  name: "ls",
  icon: FolderOpen,
  project({ args, rawResult }) {
    const path = getPathArg(args)
    return {
      path,
      resultText: rawResult,
      target: path ? getBasename(path) : null
    }
  },
  hasDetail({ viewModel }) {
    return Boolean(viewModel.path || viewModel.resultText)
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.target,
      title: copy.toolCall.labels.ls
    }
  },
  renderDetail({ viewModel }) {
    if (!viewModel.path && !viewModel.resultText) {
      return null
    }

    return (
      <ToolDetailStack>
        {viewModel.path ? (
          <ToolDetailText className="text-[var(--jingle-agent-timeline-muted)]">
            {viewModel.path}
          </ToolDetailText>
        ) : null}
        {viewModel.resultText ? <ToolDetailText>{viewModel.resultText}</ToolDetailText> : null}
      </ToolDetailStack>
    )
  }
})

defineToolComponent({
  name: "glob",
  icon: FolderOpen,
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
      title: copy.toolCall.labels.glob
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
