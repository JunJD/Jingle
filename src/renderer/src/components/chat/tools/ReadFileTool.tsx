import { FileText } from "lucide-react"
import { CodeBlock } from "@/components/ui/code-block"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getBasename, getPathArg, joinSummaryParts } from "./shared"

defineToolComponent({
  name: "read_file",
  icon: FileText,
  renderSummary({ copy, args }) {
    const path = getPathArg(args)
    const target = path ? getBasename(path) : copy.toolCall.labels.read_file

    return joinSummaryParts(copy.toolCall.labels.read_file, target)
  },
  renderDetail({ args, rawResult }) {
    const path = getPathArg(args)
    const content = rawResult

    if (!path && !content) {
      return null
    }

    return (
      <ToolDetailStack>
        {path ? <ToolCodeBlock>{path}</ToolCodeBlock> : null}
        {content ? (
          <CodeBlock code={content} filename={path ? getBasename(path) : undefined} maxLines={12} />
        ) : null}
      </ToolDetailStack>
    )
  }
})
