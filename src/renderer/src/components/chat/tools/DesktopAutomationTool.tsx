import { AppWindow, MousePointerClick, Route, ScanSearch } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolCodeBlock, ToolDetailStack } from "./shared-components"
import { stringifyToolValue } from "./shared"

function getStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

defineToolComponent({
  name: "open_application",
  icon: AppWindow,
  hasDetail({ rawArgs, rawResult }) {
    return Boolean(rawArgs || rawResult)
  },
  renderDisplay({ copy, args }) {
    return {
      detail: getStringArg(args, "name") ?? getStringArg(args, "bundleId"),
      title: copy.toolCall.labels.open_application
    }
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
  hasDetail({ rawArgs, rawResult }) {
    return Boolean(rawArgs || rawResult)
  },
  renderDisplay({ copy, args }) {
    return {
      detail: getStringArg(args, "url"),
      title: copy.toolCall.labels.open_desktop_route
    }
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
  hasDetail({ rawArgs, rawResult }) {
    return Boolean(rawArgs || rawResult)
  },
  renderDisplay({ copy, args }) {
    return {
      detail: getStringArg(args, "titleContains") ?? getStringArg(args, "role"),
      title: copy.toolCall.labels.find_ax_elements
    }
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
  hasDetail({ rawArgs, rawResult }) {
    return Boolean(rawArgs || rawResult)
  },
  renderDisplay({ copy, args }) {
    return {
      detail: getStringArg(args, "titleContains"),
      title: copy.toolCall.labels.press_ax_element
    }
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
  hasDetail({ rawArgs, rawResult }) {
    return Boolean(rawArgs || rawResult)
  },
  renderDisplay({ copy, args }) {
    const x = typeof args.x === "number" ? args.x : null
    const y = typeof args.y === "number" ? args.y : null
    return {
      detail: x !== null && y !== null ? `${x}, ${y}` : null,
      title: copy.toolCall.labels.click_screen_point
    }
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
