import type { AgentConfig } from "../types"

type DesktopAutomationToolName =
  | "click_screen_point"
  | "find_ax_elements"
  | "open_application"
  | "open_desktop_route"
  | "press_ax_element"

interface DesktopAutomationTarget {
  bundleId?: string
  name?: string
}

interface DesktopAutomationPolicyDecision {
  disposition: "allow" | "deny" | "require_approval"
  reason: string
}

const APP_TARGETED_DESKTOP_AUTOMATION_TOOL_NAMES = new Set<DesktopAutomationToolName>([
  "click_screen_point",
  "find_ax_elements",
  "open_application",
  "open_desktop_route",
  "press_ax_element"
])

const DESKTOP_AUTOMATION_TOOL_NAMES = new Set<DesktopAutomationToolName>([
  ...APP_TARGETED_DESKTOP_AUTOMATION_TOOL_NAMES
])

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase()
}

function readDesktopAutomationTarget(args: Record<string, unknown>): DesktopAutomationTarget {
  return {
    bundleId: readNonEmptyString(args.bundleId),
    name: readNonEmptyString(args.name)
  }
}

function getPreferredTargetIdentifier(target: DesktopAutomationTarget): string | null {
  return target.bundleId ?? target.name ?? null
}

function isTargetAllowlisted(target: DesktopAutomationTarget, allowlist: readonly string[]): boolean {
  const identifiers = [target.bundleId, target.name]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeIdentifier)

  if (identifiers.length === 0) {
    return false
  }

  const allowlistSet = new Set(allowlist.map(normalizeIdentifier))
  return identifiers.some((identifier) => allowlistSet.has(identifier))
}

export function getDesktopAutomationPolicyDecision(
  toolName: string,
  args: Record<string, unknown>,
  agentConfig: AgentConfig
): DesktopAutomationPolicyDecision | null {
  if (!DESKTOP_AUTOMATION_TOOL_NAMES.has(toolName as DesktopAutomationToolName)) {
    return null
  }

  if (!APP_TARGETED_DESKTOP_AUTOMATION_TOOL_NAMES.has(toolName as DesktopAutomationToolName)) {
    return null
  }

  const target = readDesktopAutomationTarget(args)
  const identifier = getPreferredTargetIdentifier(target)

  if (!identifier) {
    return {
      disposition: "deny",
      reason:
        `${toolName} requires a target application identified by "bundleId" or "name". ` +
        "Add that app to Settings > General > Desktop Automation Allowlist first."
    }
  }

  if (isTargetAllowlisted(target, agentConfig.desktopAutomationAllowlist)) {
    return {
      disposition: "allow",
      reason: `Desktop automation for "${identifier}" is allowlisted.`
    }
  }

  return {
    disposition: "deny",
    reason:
      `Desktop automation for "${identifier}" is not allowlisted. ` +
      'Add the bundle id or app name to Settings > General > Desktop Automation Allowlist.'
  }
}
