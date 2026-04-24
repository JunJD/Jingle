import { createMiddleware, tool } from "langchain"
import { createDesktopAutomationRunner } from "../services/desktop-automation-native"
import {
  clickScreenPoint,
  findAxElements,
  openApplication,
  openDesktopRoute,
  pressAxElement
} from "../services/desktop-automation"
import {
  parseClickScreenPointRequest,
  parseFindAxElementsRequest,
  parseOpenApplicationRequest,
  parseOpenDesktopRouteRequest,
  parsePressAxElementRequest
} from "../services/desktop-automation-parser"

const desktopAutomationRunner = createDesktopAutomationRunner()

const openApplicationTool = tool(
  async (input) => {
    const request = parseOpenApplicationRequest(input)
    return openApplication(request, desktopAutomationRunner)
  },
  {
    description:
      "Open or activate a macOS application by bundle id or visible app name. Use this before AX actions when the target app must be running.",
    name: "open_application",
    schema: {
      additionalProperties: false,
      properties: {
        bundleId: {
          description: "The macOS bundle identifier, for example com.netease.163music.",
          type: "string"
        },
        name: {
          description: 'The visible macOS application name, for example "NeteaseMusic".',
          type: "string"
        }
      },
      type: "object"
    }
  }
)

const openDesktopRouteTool = tool(
  async (input) => {
    const request = parseOpenDesktopRouteRequest(input)
    return openDesktopRoute(request, desktopAutomationRunner)
  },
  {
    description:
      "Open a desktop route through macOS Launch Services, including app URL schemes like orpheus:// and normal URLs. Include bundleId or name when the route targets an allowlisted desktop app.",
    name: "open_desktop_route",
    schema: {
      additionalProperties: false,
      properties: {
        bundleId: {
          description: "Optional target app bundle identifier used for desktop automation allowlist checks.",
          type: "string"
        },
        name: {
          description: "Optional target app visible name used for desktop automation allowlist checks.",
          type: "string"
        },
        url: {
          description: "The absolute URL or app route to open.",
          type: "string"
        }
      },
      required: ["url"],
      type: "object"
    }
  }
)

const findAxElementsTool = tool(
  async (input) => {
    const request = parseFindAxElementsRequest(input)
    return findAxElements(request, desktopAutomationRunner)
  },
  {
    description:
      "Inspect a running macOS app through Accessibility and return matching UI elements by title substring and optional AX role.",
    name: "find_ax_elements",
    schema: {
      additionalProperties: false,
      properties: {
        bundleId: {
          description: "The target app bundle identifier.",
          type: "string"
        },
        limit: {
          description: "Maximum number of matched elements to return. Range: 1-25.",
          type: "integer"
        },
        name: {
          description: "The target app visible name.",
          type: "string"
        },
        role: {
          description: 'Optional AX role filter, for example "AXButton".',
          type: "string"
        },
        titleContains: {
          description: 'Optional case-insensitive substring to match in title, description, or value.',
          type: "string"
        }
      },
      type: "object"
    }
  }
)

const pressAxElementTool = tool(
  async (input) => {
    const request = parsePressAxElementRequest(input)
    return pressAxElement(request, desktopAutomationRunner)
  },
  {
    description:
      "Perform AXPress on a matching element in a running macOS app. This is the preferred primitive for low-disruption desktop UI control when route opening is not enough.",
    name: "press_ax_element",
    schema: {
      additionalProperties: false,
      properties: {
        activate: {
          description: "Activate the target app before pressing when true.",
          type: "boolean"
        },
        bundleId: {
          description: "The target app bundle identifier.",
          type: "string"
        },
        matchIndex: {
          description: "Zero-based match index from find_ax_elements.",
          type: "integer"
        },
        name: {
          description: "The target app visible name.",
          type: "string"
        },
        role: {
          description: 'Optional AX role filter, for example "AXButton".',
          type: "string"
        },
        titleContains: {
          description: "Case-insensitive substring used to find the target element.",
          type: "string"
        }
      },
      required: ["titleContains"],
      type: "object"
    }
  }
)

const clickScreenPointTool = tool(
  async (input) => {
    const request = parseClickScreenPointRequest(input)
    return clickScreenPoint(request, desktopAutomationRunner)
  },
  {
    description:
      "Post a macOS left click to absolute screen coordinates. Include bundleId or name for allowlist checks when the click targets a specific desktop app.",
    name: "click_screen_point",
    schema: {
      additionalProperties: false,
      properties: {
        bundleId: {
          description: "Optional target app bundle identifier used for desktop automation allowlist checks.",
          type: "string"
        },
        hideCursor: {
          description: "Hide the cursor briefly while posting the click.",
          type: "boolean"
        },
        name: {
          description: "Optional target app visible name used for desktop automation allowlist checks.",
          type: "string"
        },
        x: {
          description: "Absolute screen X coordinate in macOS points.",
          type: "number"
        },
        y: {
          description: "Absolute screen Y coordinate in macOS points.",
          type: "number"
        }
      },
      required: ["x", "y"],
      type: "object"
    }
  }
)

const desktopAutomationToolsMiddleware = createMiddleware({
  name: "openworkDesktopAutomationTools",
  tools: [
    openApplicationTool,
    openDesktopRouteTool,
    findAxElementsTool,
    pressAxElementTool,
    clickScreenPointTool
  ]
})

export function createDesktopAutomationToolsMiddleware() {
  return desktopAutomationToolsMiddleware
}
