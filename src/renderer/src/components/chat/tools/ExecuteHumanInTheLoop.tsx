import { Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { defineHumanInTheLoop } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack, ToolFileList } from "./shared-components"
import { getCommandArg, getMutationPredictionArg } from "./shared"

defineHumanInTheLoop({
  icon: Terminal,
  name: "execute",
  render({ copy, args, rawArgs, request, respond }) {
    const requestArgs =
      request.tool_call.args &&
      typeof request.tool_call.args === "object" &&
      !Array.isArray(request.tool_call.args)
        ? request.tool_call.args
        : args
    const command = getCommandArg(requestArgs)
    const canEdit = request.allowed_decisions.includes("edit")
    const prediction = getMutationPredictionArg(requestArgs)
    const predictedFiles = prediction
      ? prediction.changes.map((change) => `${change.changeType}: ${change.path}`)
      : []

    return (
      <div className="grid min-w-0 max-w-full gap-3 overflow-hidden rounded-xl bg-status-warning/10 px-4 py-3">
        <ToolDetailStack className="text-foreground/80">
          {command ? <ToolCodeBlock>{`$ ${command}`}</ToolCodeBlock> : null}
          {!command ? <ToolCodeBlock>{rawArgs}</ToolCodeBlock> : null}
          {prediction ? (
            <div className="min-w-0 text-[12px] leading-5 [overflow-wrap:anywhere]">
              {prediction.summary}
            </div>
          ) : null}
          {predictedFiles.length > 0 ? <ToolFileList items={predictedFiles} maxItems={8} /> : null}
          {prediction?.stderr ? <ToolCodeBlock>{prediction.stderr}</ToolCodeBlock> : null}
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
