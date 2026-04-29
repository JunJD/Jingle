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
  renderSummary({ toolCall, args }) {
    return joinSummaryParts(toolCall.name, getPrimaryArg(args))
  },
  renderDetail({ copy, rawArgs, rawResult }) {
    const detailArgs = rawArgs.trim() ? rawArgs : ""
    const detailResult = rawResult

    if (!detailArgs && !detailResult) {
      return null
    }

    return (
      <ToolDetailStack>
        {detailArgs ? (
          <>
            <div className="[font-size:var(--ow-font-meta)] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {copy.common.rawArguments}
            </div>
            <ToolCodeBlock>{detailArgs}</ToolCodeBlock>
          </>
        ) : null}
        {detailResult ? (
          <>
            <div className="[font-size:var(--ow-font-meta)] font-medium uppercase tracking-[0.08em] text-muted-foreground">
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
