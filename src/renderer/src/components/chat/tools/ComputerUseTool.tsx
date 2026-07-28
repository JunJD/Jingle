import { ListTree, MonitorCog, MousePointerClick, ScanSearch, Search } from "lucide-react"
import { parseComputerUseToolResult } from "@shared/computer-use-tool-result"
import { defineToolComponent } from "./registry-core"
import { joinSummaryParts, truncateMiddle } from "./shared"
import { ToolCodeBlock, ToolContractNotice, ToolDetailStack } from "./shared-components"
import type { ToolComponentStatus, ToolProjectionInput } from "./types"

interface ComputerUseViewModel {
  detail: string | null
  invalidField: string | null
  rawArgs: string
  rawResult: string
  resultSummary: string | null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() === value && value.length > 0 ? value : null
}

function projectResultSummary(
  args: Record<string, unknown>,
  result: unknown,
  status: ToolComponentStatus,
  toolName: string
): { invalidField: string | null; summary: string | null } {
  if (status === "failed") return { invalidField: null, summary: null }
  if (status !== "complete") return { invalidField: null, summary: null }
  try {
    const parsed = parseComputerUseToolResult({ args, result, toolName })
    if (parsed.kind === "observe") {
      return {
        invalidField: null,
        summary: joinSummaryParts(
          parsed.observation.kind,
          truncateMiddle(parsed.observation.stateId, 28),
          `${parsed.observation.elements.length}`
        )
      }
    }
    if (parsed.kind === "action") {
      const stateId =
        parsed.projection?.kind === "diff"
          ? parsed.projection.successorStateId
          : parsed.projection?.stateId
      return {
        invalidField: null,
        summary: joinSummaryParts(
          parsed.result.outcome,
          parsed.projection?.kind,
          stateId ? truncateMiddle(stateId, 28) : null,
          parsed.retry.allowed ? parsed.retry.reason : null
        )
      }
    }
    return {
      invalidField: null,
      summary: joinSummaryParts(
        parsed.operation,
        truncateMiddle(parsed.result.stateId, 28),
        `${parsed.result.elements.length}`
      )
    }
  } catch {
    return { invalidField: "result", summary: null }
  }
}

function createProjection(
  input: ToolProjectionInput,
  projection: { detail: string | null; invalidField?: string | null }
): ComputerUseViewModel {
  const result = projectResultSummary(input.args, input.result, input.status, input.toolCall.name)
  return {
    detail: projection.detail,
    invalidField: projection.invalidField ?? result.invalidField,
    rawArgs: input.rawArgs,
    rawResult: input.rawResult,
    resultSummary: result.summary
  }
}

function hasDetail(viewModel: ComputerUseViewModel): boolean {
  return Boolean(viewModel.invalidField || viewModel.rawArgs.trim() || viewModel.rawResult.trim())
}

function renderDetail(
  copy: Parameters<typeof ToolContractNotice>[0]["copy"],
  viewModel: ComputerUseViewModel
): React.JSX.Element {
  return (
    <ToolDetailStack>
      {viewModel.invalidField ? (
        <ToolContractNotice copy={copy} field={viewModel.invalidField} />
      ) : null}
      <ToolCodeBlock>{viewModel.rawArgs}</ToolCodeBlock>
      <ToolCodeBlock>{viewModel.rawResult}</ToolCodeBlock>
    </ToolDetailStack>
  )
}

function requiredString(args: Record<string, unknown>, field: string): string | null {
  return readString(args[field])
}

function missingStateIdentity(args: Record<string, unknown>): string | null {
  if (!requiredString(args, "stateId")) return "stateId"
  if (!requiredString(args, "sessionId")) return "sessionId"
  return null
}

defineToolComponent({
  icon: MonitorCog,
  name: "computer_use_observe",
  project(input) {
    const applicationId = readString(input.args.applicationId)
    const applicationName = readString(input.args.applicationName)
    const windowId = readString(input.args.windowId)
    return createProjection(input, {
      detail: joinSummaryParts(applicationName, applicationId, windowId) || null,
      invalidField:
        input.status !== "arguments_streaming" && !applicationId ? "applicationId" : null
    })
  },
  hasDetail: ({ viewModel }) => hasDetail(viewModel),
  renderDisplay({ copy, viewModel }) {
    return {
      detail: joinSummaryParts(viewModel.detail, viewModel.resultSummary) || null,
      title: copy.toolCall.labels.computer_use_observe
    }
  },
  renderDetail: ({ copy, viewModel }) => renderDetail(copy, viewModel)
})

defineToolComponent({
  icon: MousePointerClick,
  name: "computer_use_action",
  project(input) {
    const stateId = requiredString(input.args, "stateId")
    const sessionId = requiredString(input.args, "sessionId")
    const actionCount = Array.isArray(input.args.actions) ? input.args.actions.length : 0
    return createProjection(input, {
      detail: joinSummaryParts(
        actionCount > 0 ? `${actionCount}` : null,
        stateId && truncateMiddle(stateId, 28)
      ),
      invalidField:
        input.status === "arguments_streaming"
          ? null
          : !stateId
            ? "stateId"
            : !sessionId
              ? "sessionId"
              : actionCount < 1
                ? "actions"
                : null
    })
  },
  hasDetail: ({ viewModel }) => hasDetail(viewModel),
  renderDisplay({ copy, viewModel }) {
    return {
      detail: joinSummaryParts(viewModel.detail, viewModel.resultSummary) || null,
      title: copy.toolCall.labels.computer_use_action
    }
  },
  renderDetail: ({ copy, viewModel }) => renderDetail(copy, viewModel)
})

defineToolComponent({
  icon: Search,
  name: "computer_use_search",
  project(input) {
    const query = requiredString(input.args, "query")
    const missingIdentity = missingStateIdentity(input.args)
    return createProjection(input, {
      detail: query ? truncateMiddle(query, 60) : null,
      invalidField:
        input.status === "arguments_streaming" ? null : !query ? "query" : missingIdentity
    })
  },
  hasDetail: ({ viewModel }) => hasDetail(viewModel),
  renderDisplay({ copy, viewModel }) {
    return {
      detail: joinSummaryParts(viewModel.detail, viewModel.resultSummary) || null,
      title: copy.toolCall.labels.computer_use_search
    }
  },
  renderDetail: ({ copy, viewModel }) => renderDetail(copy, viewModel)
})

defineToolComponent({
  icon: ListTree,
  name: "computer_use_expand",
  project(input) {
    const stateId = requiredString(input.args, "stateId")
    return createProjection(input, {
      detail: stateId ? truncateMiddle(stateId, 28) : null,
      invalidField: input.status === "arguments_streaming" ? null : missingStateIdentity(input.args)
    })
  },
  hasDetail: ({ viewModel }) => hasDetail(viewModel),
  renderDisplay({ copy, viewModel }) {
    return {
      detail: joinSummaryParts(viewModel.detail, viewModel.resultSummary) || null,
      title: copy.toolCall.labels.computer_use_expand
    }
  },
  renderDetail: ({ copy, viewModel }) => renderDetail(copy, viewModel)
})

defineToolComponent({
  icon: ScanSearch,
  name: "computer_use_inspect",
  project(input) {
    const refs = Array.isArray(input.args.refs) ? input.args.refs : null
    const missingIdentity = missingStateIdentity(input.args)
    return createProjection(input, {
      detail: refs?.length ? `${refs.length}` : null,
      invalidField:
        input.status === "arguments_streaming" ? null : !refs?.length ? "refs" : missingIdentity
    })
  },
  hasDetail: ({ viewModel }) => hasDetail(viewModel),
  renderDisplay({ copy, viewModel }) {
    return {
      detail: joinSummaryParts(viewModel.detail, viewModel.resultSummary) || null,
      title: copy.toolCall.labels.computer_use_inspect
    }
  },
  renderDetail: ({ copy, viewModel }) => renderDetail(copy, viewModel)
})
