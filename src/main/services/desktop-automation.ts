export interface DesktopAutomationApplicationTarget {
  bundleId?: string
  name?: string
}

export interface OpenApplicationRequest extends DesktopAutomationApplicationTarget {}

export interface OpenDesktopRouteRequest {
  url: string
}

export interface FindAxElementsRequest extends DesktopAutomationApplicationTarget {
  limit: number
  role?: string
  titleContains?: string
}

export interface PressAxElementRequest extends DesktopAutomationApplicationTarget {
  activate?: boolean
  matchIndex?: number
  role?: string
  titleContains: string
}

export interface ClickScreenPointRequest {
  hideCursor?: boolean
  x: number
  y: number
}

export interface DesktopApplicationResult {
  bundleId: string | null
  name: string | null
  pid: number | null
}

export interface AxElementRecord {
  actions: string[]
  description: string | null
  identifier: string | null
  index: number
  role: string | null
  subrole: string | null
  title: string | null
  value: string | null
}

export interface OpenApplicationResponse {
  application: DesktopApplicationResult
  type: "open_application"
}

export interface OpenDesktopRouteResponse {
  type: "open_desktop_route"
  url: string
}

export interface FindAxElementsResponse {
  application: DesktopApplicationResult
  elements: AxElementRecord[]
  type: "find_ax_elements"
}

export interface PressAxElementResponse {
  application: DesktopApplicationResult
  element: AxElementRecord
  type: "press_ax_element"
}

export interface ClickScreenPointResponse {
  hideCursor: boolean
  type: "click_screen_point"
  x: number
  y: number
}

export type NativeDesktopAutomationRequest =
  | ({ type: "open_application" } & DesktopAutomationApplicationTarget)
  | ({ type: "open_desktop_route" } & OpenDesktopRouteRequest)
  | ({ type: "find_ax_elements" } & FindAxElementsRequest)
  | ({ type: "press_ax_element" } & PressAxElementRequest)
  | ({ type: "click_screen_point" } & ClickScreenPointRequest)

export type NativeDesktopAutomationResponse =
  | OpenApplicationResponse
  | OpenDesktopRouteResponse
  | FindAxElementsResponse
  | PressAxElementResponse
  | ClickScreenPointResponse

export interface DesktopAutomationRunner {
  platform: NodeJS.Platform
  run: (request: NativeDesktopAutomationRequest) => Promise<NativeDesktopAutomationResponse>
}

function assertDesktopAutomationPlatform(platform: NodeJS.Platform): void {
  if (platform !== "darwin") {
    throw new Error("Desktop automation tools are currently only supported on macOS.")
  }
}

function expectDesktopAutomationResponse<TType extends NativeDesktopAutomationResponse["type"]>(
  response: NativeDesktopAutomationResponse,
  expectedType: TType
): Extract<NativeDesktopAutomationResponse, { type: TType }> {
  if (response.type !== expectedType) {
    throw new Error(
      `Desktop automation runner returned "${response.type}" for "${expectedType}" request.`
    )
  }

  return response as Extract<NativeDesktopAutomationResponse, { type: TType }>
}

export async function openApplication(
  request: OpenApplicationRequest,
  runner: DesktopAutomationRunner
): Promise<DesktopApplicationResult> {
  assertDesktopAutomationPlatform(runner.platform)
  const response = expectDesktopAutomationResponse(
    await runner.run({
      type: "open_application",
      ...request
    }),
    "open_application"
  )

  return response.application
}

export async function openDesktopRoute(
  request: OpenDesktopRouteRequest,
  runner: DesktopAutomationRunner
): Promise<OpenDesktopRouteResponse> {
  assertDesktopAutomationPlatform(runner.platform)
  return expectDesktopAutomationResponse(
    await runner.run({
      type: "open_desktop_route",
      ...request
    }),
    "open_desktop_route"
  )
}

export async function findAxElements(
  request: FindAxElementsRequest,
  runner: DesktopAutomationRunner
): Promise<FindAxElementsResponse> {
  assertDesktopAutomationPlatform(runner.platform)
  return expectDesktopAutomationResponse(
    await runner.run({
      type: "find_ax_elements",
      ...request
    }),
    "find_ax_elements"
  )
}

export async function pressAxElement(
  request: PressAxElementRequest,
  runner: DesktopAutomationRunner
): Promise<PressAxElementResponse> {
  assertDesktopAutomationPlatform(runner.platform)
  return expectDesktopAutomationResponse(
    await runner.run({
      type: "press_ax_element",
      ...request
    }),
    "press_ax_element"
  )
}

export async function clickScreenPoint(
  request: ClickScreenPointRequest,
  runner: DesktopAutomationRunner
): Promise<ClickScreenPointResponse> {
  assertDesktopAutomationPlatform(runner.platform)
  return expectDesktopAutomationResponse(
    await runner.run({
      type: "click_screen_point",
      ...request
    }),
    "click_screen_point"
  )
}
