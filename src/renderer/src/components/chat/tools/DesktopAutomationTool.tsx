import { AppWindow, MousePointerClick, Route, ScanSearch } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { getPathArg, joinSummaryParts, stringifyToolValue } from "./shared"

function getStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

defineToolComponent({
  name: "open_application",
  icon: AppWindow,
  renderSummary({ copy, args }) {
    return joinSummaryParts(
      copy.toolCall.labels.open_application,
      getStringArg(args, "name") ?? getStringArg(args, "bundleId")
    )
  },
  renderDetail({ rawArgs, rawResult }) {
    return (
      <ToolDetailStack>
        <ToolCodeBlock>{rawArgs}</ToolCodeBlock>
        <ToolCodeBlock>{rawResult}</ToolCodeBlock>
      </ToolDetailStack>
    )
  }
})

defineToolComponent({
  name: "open_desktop_route",
  icon: Route,
  renderSummary({ copy, args }) {
    return joinSummaryParts(copy.toolCall.labels.open_desktop_route, getStringArg(args, "url"))
  },
  renderDetail({ rawArgs, rawResult }) {
    return (
      <ToolDetailStack>
        <ToolCodeBlock>{rawArgs}</ToolCodeBlock>
        <ToolCodeBlock>{rawResult}</ToolCodeBlock>
      </ToolDetailStack>
    )
  }
})

defineToolComponent({
  name: "find_ax_elements",
  icon: ScanSearch,
  renderSummary({ copy, args }) {
    return joinSummaryParts(
      copy.toolCall.labels.find_ax_elements,
      getStringArg(args, "titleContains") ?? getStringArg(args, "role")
    )
  },
  renderDetail({ rawArgs, rawResult }) {
    return (
      <ToolDetailStack>
        <ToolCodeBlock>{rawArgs}</ToolCodeBlock>
        <ToolCodeBlock>{rawResult}</ToolCodeBlock>
      </ToolDetailStack>
    )
  }
})

defineToolComponent({
  name: "press_ax_element",
  icon: MousePointerClick,
  renderSummary({ copy, args }) {
    return joinSummaryParts(
      copy.toolCall.labels.press_ax_element,
      getStringArg(args, "titleContains") ?? getPathArg(args)
    )
  },
  renderDetail({ rawArgs, rawResult }) {
    return (
      <ToolDetailStack>
        <ToolCodeBlock>{rawArgs}</ToolCodeBlock>
        <ToolCodeBlock>{rawResult}</ToolCodeBlock>
      </ToolDetailStack>
    )
  }
})

defineToolComponent({
  name: "click_screen_point",
  icon: MousePointerClick,
  renderSummary({ copy, args }) {
    const x = typeof args.x === "number" ? args.x : null
    const y = typeof args.y === "number" ? args.y : null
    return joinSummaryParts(
      copy.toolCall.labels.click_screen_point,
      x !== null && y !== null ? `${x}, ${y}` : null
    )
  },
  renderDetail({ args, rawResult }) {
    return (
      <ToolDetailStack>
        <ToolCodeBlock>{stringifyToolValue(args)}</ToolCodeBlock>
        <ToolCodeBlock>{rawResult}</ToolCodeBlock>
      </ToolDetailStack>
    )
  }
})
