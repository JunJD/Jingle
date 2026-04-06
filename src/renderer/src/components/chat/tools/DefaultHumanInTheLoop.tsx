import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import type { HumanInTheLoopDefinition } from "./types"

export const defaultHumanInTheLoop: HumanInTheLoopDefinition = {
  icon: TriangleAlert,
  name: "*",
  render({ copy, rawArgs, request, respond }) {
    const canEdit = request.allowed_decisions.includes("edit")

    return (
      <div className="grid min-w-0 max-w-full gap-3 overflow-hidden rounded-xl bg-status-warning/10 px-4 py-3">
        {rawArgs ? (
          <ToolDetailStack className="text-foreground/80">
            <ToolCodeBlock>{rawArgs}</ToolCodeBlock>
          </ToolDetailStack>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit ? (
            <Button onClick={() => respond("edit")} size="sm" type="button" variant="ghost">
              {copy.toolCall.edit}
            </Button>
          ) : null}
          <Button onClick={() => respond("reject")} size="sm" type="button" variant="outline">
            {copy.toolCall.reject}
          </Button>
          <Button onClick={() => respond("approve")} size="sm" type="button" variant="warning">
            {copy.toolCall.approveAndRun}
          </Button>
        </div>
      </div>
    )
  }
}
