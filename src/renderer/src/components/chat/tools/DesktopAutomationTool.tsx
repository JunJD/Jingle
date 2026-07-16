import { AppWindow, MousePointerClick, Route, ScanSearch } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolContractNotice, ToolDetailStack } from "./shared-components"
import { joinSummaryParts } from "./shared"
import type { ToolProjectionInput } from "./types"

function getStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

interface DesktopAutomationViewModel {
  detail: string | null
  missingField: string | null
  rawArgs: string
  rawResult: string
}

function projectDesktopAutomation(
  input: ToolProjectionInput,
  projectSummary: (args: Record<string, unknown>) => {
    details: Array<string | null>
    missingFields?: string[]
  }
): DesktopAutomationViewModel {
  const projection = projectSummary(input.args)
  const detail = joinSummaryParts(...projection.details)
  return {
    detail: detail.length > 0 ? detail : null,
    missingField:
      input.status !== "arguments_streaming" &&
      projection.missingFields &&
      projection.missingFields.length > 0
        ? projection.missingFields.join("|")
        : null,
    rawArgs: input.rawArgs,
    rawResult: input.rawResult
  }
}

function hasDesktopAutomationDetail(viewModel: DesktopAutomationViewModel): boolean {
  return Boolean(viewModel.missingField || viewModel.rawArgs || viewModel.rawResult)
}

function renderDesktopAutomationDetail(
  copy: Parameters<typeof ToolContractNotice>[0]["copy"],
  viewModel: DesktopAutomationViewModel
): React.JSX.Element {
  return (
    <ToolDetailStack>
      {viewModel.missingField ? (
        <ToolContractNotice copy={copy} field={viewModel.missingField} />
      ) : null}
      <ToolCodeBlock>{viewModel.rawArgs}</ToolCodeBlock>
      <ToolCodeBlock>{viewModel.rawResult}</ToolCodeBlock>
    </ToolDetailStack>
  )
}

function projectApplicationTarget(args: Record<string, unknown>): {
  details: Array<string | null>
  missingFields: string[]
} {
  const name = getStringArg(args, "name")
  const bundleId = getStringArg(args, "bundleId")
  return {
    details: [name, bundleId],
    missingFields: name || bundleId ? [] : ["name|bundleId"]
  }
}

defineToolComponent({
  name: "open_application",
  icon: AppWindow,
  project(input) {
    return projectDesktopAutomation(input, projectApplicationTarget)
  },
  hasDetail({ viewModel }) {
    return hasDesktopAutomationDetail(viewModel)
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.open_application
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderDesktopAutomationDetail(copy, viewModel)
  }
})

defineToolComponent({
  name: "open_desktop_route",
  icon: Route,
  project(input) {
    return projectDesktopAutomation(input, (args) => {
      const url = getStringArg(args, "url")
      return {
        details: [url, getStringArg(args, "name"), getStringArg(args, "bundleId")],
        missingFields: url ? [] : ["url"]
      }
    })
  },
  hasDetail({ viewModel }) {
    return hasDesktopAutomationDetail(viewModel)
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.open_desktop_route
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderDesktopAutomationDetail(copy, viewModel)
  }
})

defineToolComponent({
  name: "find_ax_elements",
  icon: ScanSearch,
  project(input) {
    return projectDesktopAutomation(input, (args) => {
      const target = projectApplicationTarget(args)
      return {
        details: [
          ...target.details,
          getStringArg(args, "titleContains"),
          getStringArg(args, "role")
        ],
        missingFields: target.missingFields
      }
    })
  },
  hasDetail({ viewModel }) {
    return hasDesktopAutomationDetail(viewModel)
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.find_ax_elements
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderDesktopAutomationDetail(copy, viewModel)
  }
})

defineToolComponent({
  name: "press_ax_element",
  icon: MousePointerClick,
  project(input) {
    return projectDesktopAutomation(input, (args) => {
      const target = projectApplicationTarget(args)
      const title = getStringArg(args, "titleContains")
      return {
        details: [...target.details, title],
        missingFields: [...target.missingFields, ...(title ? [] : ["titleContains"])]
      }
    })
  },
  hasDetail({ viewModel }) {
    return hasDesktopAutomationDetail(viewModel)
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.press_ax_element
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderDesktopAutomationDetail(copy, viewModel)
  }
})

defineToolComponent({
  name: "click_screen_point",
  icon: MousePointerClick,
  project(input) {
    return projectDesktopAutomation(input, (args) => {
      const x = typeof args.x === "number" && Number.isFinite(args.x) ? args.x : null
      const y = typeof args.y === "number" && Number.isFinite(args.y) ? args.y : null
      return {
        details: [
          x !== null && y !== null ? `${x}, ${y}` : null,
          getStringArg(args, "name"),
          getStringArg(args, "bundleId")
        ],
        missingFields: [x === null ? "x" : null, y === null ? "y" : null].filter(
          (field): field is string => field !== null
        )
      }
    })
  },
  hasDetail({ viewModel }) {
    return hasDesktopAutomationDetail(viewModel)
  },
  renderDisplay({ copy, viewModel }) {
    return {
      detail: viewModel.detail,
      title: copy.toolCall.labels.click_screen_point
    }
  },
  renderDetail({ copy, viewModel }) {
    return renderDesktopAutomationDetail(copy, viewModel)
  }
})
