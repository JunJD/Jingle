import { Edit } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack, ToolPreviewLines } from "./shared-components"
import { countLines, getBasename, getPathArg, isNonEmptyString, joinSummaryParts } from "./shared"
import type { ToolComponentProps } from "./types"

function buildMutationSummary(props: ToolComponentProps, mode: "edit_file" | "write_file"): string {
  const { copy, args, status } = props
  const path = getPathArg(args)
  const target = path ? getBasename(path) : copy.toolCall.labels[mode]
  const content = isNonEmptyString(args.content) ? args.content : ""
  const statusLabel =
    status === "running" ? copy.common.running : status === "approval" ? copy.common.approval : null

  return joinSummaryParts(
    copy.toolCall.labels[mode],
    target,
    mode === "write_file" && content
      ? copy.toolCall.writeLinesToFile(countLines(content), target)
      : statusLabel
  )
}

function renderMutationDetail(
  args: Record<string, unknown>,
  options: { rawResult: string }
): React.JSX.Element | null {
  const path = getPathArg(args)
  const content = isNonEmptyString(args.content) ? args.content : ""
  const oldValue = isNonEmptyString(args.old_str) ? args.old_str : ""
  const newValue = isNonEmptyString(args.new_str) ? args.new_str : ""
  const rawResult = options.rawResult

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
  renderDetail({ args, rawResult }) {
    return renderMutationDetail(args, { rawResult })
  }
})

defineToolComponent({
  name: "write_file",
  icon: Edit,
  renderSummary(props) {
    return buildMutationSummary(props, "write_file")
  },
  renderDetail({ args, rawResult }) {
    return renderMutationDetail(args, { rawResult })
  }
})
