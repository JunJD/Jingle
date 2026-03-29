import { Edit } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack, ToolPreviewLines } from "./shared-components"
import { countLines, getBasename, getPathArg, isNonEmptyString, joinSummaryParts } from "./shared"
import type { ToolComponentProps } from "./types"

function buildMutationSummary(props: ToolComponentProps, mode: "edit_file" | "write_file"): string {
  const { copy, args, hasResult, status } = props
  const path = getPathArg(args)
  const target = path ? getBasename(path) : copy.toolCall.labels[mode]
  const content = isNonEmptyString(args.content) ? args.content : ""

  return joinSummaryParts(
    copy.toolCall.labels[mode],
    target,
    status === "running"
      ? copy.common.running
      : status === "approval"
        ? copy.common.approval
        : status === "error"
          ? copy.common.error
          : mode === "write_file" && content
            ? copy.toolCall.writeLinesToFile(countLines(content), target)
            : hasResult
              ? copy.toolCall.fileSaved
              : copy.common.completed
  )
}

function renderMutationDetail(
  args: Record<string, unknown>,
  options: { rawResult: string; status: ToolComponentProps["status"] }
): React.JSX.Element | null {
  const path = getPathArg(args)
  const content = isNonEmptyString(args.content) ? args.content : ""
  const oldValue = isNonEmptyString(args.old_str) ? args.old_str : ""
  const newValue = isNonEmptyString(args.new_str) ? args.new_str : ""
  const rawResult = options.status === "error" ? "" : options.rawResult

  if (!path && !content && !oldValue && !newValue && !rawResult) {
    return null
  }

  return (
    <ToolDetailStack>
      {path ? <ToolCodeBlock>{path}</ToolCodeBlock> : null}
      {oldValue || newValue ? (
        <div className="grid gap-1 text-[12px] leading-5 text-foreground/80">
          {oldValue ? <div className="break-all">- {truncateToSingleLine(oldValue)}</div> : null}
          {newValue ? <div className="break-all">+ {truncateToSingleLine(newValue)}</div> : null}
        </div>
      ) : null}
      {content ? <ToolPreviewLines text={content} maxLines={10} /> : null}
      {rawResult ? <ToolCodeBlock>{rawResult}</ToolCodeBlock> : null}
    </ToolDetailStack>
  )
}

function truncateToSingleLine(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact
}

defineToolComponent({
  name: "edit_file",
  icon: Edit,
  renderSummary(props) {
    return buildMutationSummary(props, "edit_file")
  },
  renderDetail({ args, rawResult, status }) {
    return renderMutationDetail(args, { rawResult, status })
  }
})

defineToolComponent({
  name: "write_file",
  icon: Edit,
  renderSummary(props) {
    return buildMutationSummary(props, "write_file")
  },
  renderDetail({ args, rawResult, status }) {
    return renderMutationDetail(args, { rawResult, status })
  }
})
