import { createMiddleware, tool } from "langchain"

export interface JingleDesktopAutomationToolHandlers {
  clickScreenPoint: (input: unknown) => Promise<unknown>
  findAxElements: (input: unknown) => Promise<unknown>
  openApplication: (input: unknown) => Promise<unknown>
  openDesktopRoute: (input: unknown) => Promise<unknown>
  pressAxElement: (input: unknown) => Promise<unknown>
}

export function createJingleDesktopAutomationToolsMiddleware(
  handlers: JingleDesktopAutomationToolHandlers
) {
  const openApplicationTool = tool(handlers.openApplication, {
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
  })

  const openDesktopRouteTool = tool(handlers.openDesktopRoute, {
    description:
      "Open a desktop route through macOS Launch Services, including app URL schemes like orpheus:// and normal URLs. Include bundleId or name when the route targets an allowlisted desktop app.",
    name: "open_desktop_route",
    schema: {
      additionalProperties: false,
      properties: {
        bundleId: {
          description:
            "Optional target app bundle identifier used for desktop automation allowlist checks.",
          type: "string"
        },
        name: {
          description:
            "Optional target app visible name used for desktop automation allowlist checks.",
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
  })

  const findAxElementsTool = tool(handlers.findAxElements, {
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
          description:
            "Optional case-insensitive substring to match in title, description, or value.",
          type: "string"
        }
      },
      type: "object"
    }
  })

  const pressAxElementTool = tool(handlers.pressAxElement, {
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
  })

  const clickScreenPointTool = tool(handlers.clickScreenPoint, {
    description:
      "Post a macOS left click to absolute screen coordinates. Include bundleId or name for allowlist checks when the click targets a specific desktop app.",
    name: "click_screen_point",
    schema: {
      additionalProperties: false,
      properties: {
        bundleId: {
          description:
            "Optional target app bundle identifier used for desktop automation allowlist checks.",
          type: "string"
        },
        hideCursor: {
          description: "Hide the cursor briefly while posting the click.",
          type: "boolean"
        },
        name: {
          description:
            "Optional target app visible name used for desktop automation allowlist checks.",
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
  })

  return createMiddleware({
    name: "jingleDesktopAutomationTools",
    tools: [
      openApplicationTool,
      openDesktopRouteTool,
      findAxElementsTool,
      pressAxElementTool,
      clickScreenPointTool
    ]
  })
}
