import { Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { defineHumanInTheLoop } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getCommandArg } from "./shared"

defineHumanInTheLoop({
  icon: Terminal,
  name: "execute",
  render({ copy, args, rawArgs, request, respond }) {
    const command = getCommandArg(args)
    const canEdit = request.allowed_decisions.includes("edit")

    return (
      <div className="grid gap-3 rounded-xl bg-status-warning/10 px-4 py-3">
        <ToolDetailStack className="text-foreground/80">
          {command ? <ToolCodeBlock>{`$ ${command}`}</ToolCodeBlock> : null}
          {!command ? <ToolCodeBlock>{rawArgs}</ToolCodeBlock> : null}
        </ToolDetailStack>
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
})
