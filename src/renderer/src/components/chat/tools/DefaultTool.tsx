import { Wrench } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getCommandArg, getPathArg, getPatternArg, joinSummaryParts } from "./shared"
import type { ToolComponentDefinition } from "./types"

function getPrimaryArg(args: Record<string, unknown>): string | null {
  return getPathArg(args) ?? getCommandArg(args) ?? getPatternArg(args)
}

export const defaultToolComponent: ToolComponentDefinition = {
  name: "*",
  icon: Wrench,
  renderSummary({ copy, toolCall, args, status }) {
    const statusLabel =
      status === "approval"
        ? copy.common.approval
        : status === "running"
          ? copy.common.running
          : status === "error"
            ? copy.common.error
            : copy.common.completed

    return joinSummaryParts(toolCall.name, getPrimaryArg(args), statusLabel)
  },
  renderDetail({ copy, rawArgs, rawResult, status }) {
    const detailArgs = rawArgs.trim() ? rawArgs : ""
    const detailResult = status === "error" ? "" : rawResult

    if (!detailArgs && !detailResult) {
      return null
    }

    return (
      <ToolDetailStack>
        {detailArgs ? (
          <>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {copy.common.rawArguments}
            </div>
            <ToolCodeBlock>{detailArgs}</ToolCodeBlock>
          </>
        ) : null}
        {detailResult ? (
          <>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {copy.common.rawResult}
            </div>
            <ToolCodeBlock>{detailResult}</ToolCodeBlock>
          </>
        ) : null}
      </ToolDetailStack>
    )
  }
}

defineToolComponent(defaultToolComponent)
