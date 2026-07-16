import { FileText } from "lucide-react"
import { CodeBlock } from "@/components/ui/code-block"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolContractNotice, ToolDetailStack } from "./shared-components"
import { countLines, getBasename, projectRequiredStringArg } from "./shared"

defineToolComponent({
  name: "read_file",
  icon: FileText,
  project({ args, rawResult, status }) {
    const path = projectRequiredStringArg(args, "file_path", status === "arguments_streaming")
    return {
      content: rawResult,
      lineCount: rawResult.trim() ? countLines(rawResult) : null,
      path,
      target: path.kind === "ready" ? getBasename(path.value) : null
    }
  },
  hasDetail({ viewModel }) {
    return (
      viewModel.path.kind === "invalid" ||
      Boolean(viewModel.path.kind === "ready" && viewModel.path.value) ||
      Boolean(viewModel.content)
    )
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail:
        viewModel.target ??
        (viewModel.lineCount === null ? null : copy.toolCall.readLines(viewModel.lineCount)),
      title: copy.toolCall.labels.read_file
    }
  },
  renderDetail({ copy, viewModel }) {
    return (
      <ToolDetailStack>
        {viewModel.path.kind === "invalid" ? (
          <ToolContractNotice copy={copy} field={viewModel.path.field} />
        ) : viewModel.path.kind === "ready" ? (
          <ToolCodeBlock className="text-[var(--jingle-agent-timeline-muted)]">
            {viewModel.path.value}
          </ToolCodeBlock>
        ) : null}
        {viewModel.content ? (
          <CodeBlock
            code={viewModel.content}
            copiedLabel={copy.common.copied}
            copyErrorLabel={copy.common.copyFailed}
            copyLabel={copy.common.copy}
            filename={viewModel.target ?? undefined}
            maxLines={12}
            moreLinesLabel={copy.toolCall.moreLines}
          />
        ) : null}
      </ToolDetailStack>
    )
  }
})
