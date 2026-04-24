import type {
  ClickScreenPointRequest,
  DesktopAutomationApplicationTarget,
  FindAxElementsRequest,
  OpenApplicationRequest,
  OpenDesktopRouteRequest,
  PressAxElementRequest
} from "./desktop-automation"

const DEFAULT_AX_LIMIT = 10
const MAX_AX_LIMIT = 25

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readOptionalNonEmptyString(
  value: unknown,
  argName: string,
  toolName: string
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName} requires "${argName}" to be a non-empty string when provided.`)
  }

  return value.trim()
}

function parseApplicationTarget(
  input: unknown,
  toolName: string
): DesktopAutomationApplicationTarget {
  if (!isRecord(input)) {
    throw new Error(`${toolName} requires an object input.`)
  }

  const bundleId = readOptionalNonEmptyString(input.bundleId, "bundleId", toolName)
  const name = readOptionalNonEmptyString(input.name, "name", toolName)

  if (!bundleId && !name) {
    throw new Error(`${toolName} requires a non-empty "bundleId" or "name" string.`)
  }

  return { bundleId, name }
}

function parseOptionalRole(input: Record<string, unknown>, toolName: string): string | undefined {
  return readOptionalNonEmptyString(input.role, "role", toolName)
}

function parseOptionalBoolean(
  value: unknown,
  argName: string,
  toolName: string
): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "boolean") {
    throw new Error(`${toolName} requires "${argName}" to be a boolean when provided.`)
  }

  return value
}

export function parseOpenApplicationRequest(input: unknown): OpenApplicationRequest {
  return parseApplicationTarget(input, "open_application")
}

export function parseOpenDesktopRouteRequest(input: unknown): OpenDesktopRouteRequest {
  if (!isRecord(input) || typeof input.url !== "string" || input.url.trim().length === 0) {
    throw new Error('open_desktop_route requires a non-empty "url" string.')
  }

  let url: URL
  try {
    url = new URL(input.url.trim())
  } catch {
    throw new Error('open_desktop_route requires a valid "url" value.')
  }

  return { url: url.toString() }
}

export function parseFindAxElementsRequest(input: unknown): FindAxElementsRequest {
  const target = parseApplicationTarget(input, "find_ax_elements")
  const record = input as Record<string, unknown>
  const limitValue = record.limit
  let limit = DEFAULT_AX_LIMIT

  if (limitValue !== undefined) {
    if (!Number.isInteger(limitValue) || (limitValue as number) < 1 || (limitValue as number) > MAX_AX_LIMIT) {
      throw new Error(
        `find_ax_elements requires "limit" to be an integer between 1 and ${MAX_AX_LIMIT}.`
      )
    }

    limit = limitValue as number
  }

  return {
    ...target,
    limit,
    role: parseOptionalRole(record, "find_ax_elements"),
    titleContains: readOptionalNonEmptyString(
      record.titleContains,
      "titleContains",
      "find_ax_elements"
    )
  }
}

export function parsePressAxElementRequest(input: unknown): PressAxElementRequest {
  const target = parseApplicationTarget(input, "press_ax_element")
  const record = input as Record<string, unknown>

  const titleContains = readOptionalNonEmptyString(
    record.titleContains,
    "titleContains",
    "press_ax_element"
  )
  if (!titleContains) {
    throw new Error('press_ax_element requires a non-empty "titleContains" string.')
  }

  const matchIndex = record.matchIndex
  if (
    matchIndex !== undefined &&
    (!Number.isInteger(matchIndex) || (matchIndex as number) < 0)
  ) {
    throw new Error('press_ax_element requires "matchIndex" to be a non-negative integer.')
  }

  return {
    ...target,
    activate: parseOptionalBoolean(record.activate, "activate", "press_ax_element"),
    matchIndex: matchIndex as number | undefined,
    role: parseOptionalRole(record, "press_ax_element"),
    titleContains
  }
}

export function parseClickScreenPointRequest(input: unknown): ClickScreenPointRequest {
  if (!isRecord(input) || !Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    throw new Error('click_screen_point requires finite "x" and "y" numbers.')
  }

  return {
    hideCursor: parseOptionalBoolean(input.hideCursor, "hideCursor", "click_screen_point"),
    x: input.x as number,
    y: input.y as number
  }
}
