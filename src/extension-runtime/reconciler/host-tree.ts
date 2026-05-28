import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionSurfaceSnapshot
} from "../../shared/extension-runtime-protocol"
import type { ExtensionHostElementType } from "../sdk/host-elements"

export type RuntimeHostProps = Record<string, unknown>

export interface RuntimeHostElementNode {
  children: RuntimeHostChild[]
  kind: "element"
  props: RuntimeHostProps
  type: ExtensionHostElementType
}

export interface RuntimeHostTextNode {
  kind: "text"
  text: string
}

export type RuntimeHostChild = RuntimeHostElementNode | RuntimeHostTextNode

export interface RuntimeActionHandler {
  disabled: boolean
  handler: (params?: RuntimeActionHandlerParams) => Promise<unknown> | unknown
}

export interface RuntimeActionHandlerParams {
  formValues?: Record<string, unknown>
}

export type RuntimeHostRequestHandler = (
  request: ExtensionHostRequest
) => Promise<ExtensionHostResponse> | ExtensionHostResponse

export interface RuntimeSnapshotContext {
  commandName: string
  extensionName: string
}

export interface RuntimeHostContainer {
  actionHandlers: Map<string, RuntimeActionHandler>
  children: RuntimeHostChild[]
  context: RuntimeSnapshotContext
  latestSnapshot: ExtensionSurfaceSnapshot | null
  menuBarActionHandlers: Map<string, RuntimeActionHandler>
  nextHostRequestId: () => string
  nextToastActionId: () => string
  onCommit: () => void
  requestHost: RuntimeHostRequestHandler | null
  revision: number
  snapshots: ExtensionSurfaceSnapshot[]
  toastActionHandlers: Map<string, RuntimeActionHandler>
}

export function createHostContainer(params: {
  context: RuntimeSnapshotContext
  onCommit: () => void
  requestHost?: RuntimeHostRequestHandler
}): RuntimeHostContainer {
  let hostRequestIndex = 0
  let toastActionIndex = 0
  return {
    actionHandlers: new Map(),
    children: [],
    context: params.context,
    latestSnapshot: null,
    menuBarActionHandlers: new Map(),
    nextHostRequestId: () => `host-request-${hostRequestIndex++}`,
    nextToastActionId: () => `toast-action-${toastActionIndex++}`,
    onCommit: params.onCommit,
    requestHost: params.requestHost ?? null,
    revision: 0,
    snapshots: [],
    toastActionHandlers: new Map()
  }
}

export function createHostElement(
  type: ExtensionHostElementType,
  props: RuntimeHostProps
): RuntimeHostElementNode {
  return {
    children: [],
    kind: "element",
    props: createHostPropsWithoutChildren(props),
    type
  }
}

export function createHostText(text: string): RuntimeHostTextNode {
  return {
    kind: "text",
    text
  }
}

export function appendHostChild(
  parent: RuntimeHostContainer | RuntimeHostElementNode,
  child: RuntimeHostChild
): void {
  detachHostChildIfPresent(parent.children, child)
  parent.children.push(child)
}

export function insertHostChildBefore(
  parent: RuntimeHostContainer | RuntimeHostElementNode,
  child: RuntimeHostChild,
  beforeChild: RuntimeHostChild
): void {
  if (child === beforeChild) {
    return
  }

  requireHostChildIndex(parent.children, beforeChild)
  detachHostChildIfPresent(parent.children, child)
  const nextIndex = requireHostChildIndex(parent.children, beforeChild)
  parent.children.splice(nextIndex, 0, child)
}

export function removeHostChild(
  parent: RuntimeHostContainer | RuntimeHostElementNode,
  child: RuntimeHostChild
): void {
  const currentIndex = requireHostChildIndex(parent.children, child)
  parent.children.splice(currentIndex, 1)
}

export function updateHostElementProps(
  element: RuntimeHostElementNode,
  nextProps: RuntimeHostProps
): void {
  element.props = createHostPropsWithoutChildren(nextProps)
}

function createHostPropsWithoutChildren(props: RuntimeHostProps): RuntimeHostProps {
  const hostProps = { ...props }
  delete hostProps.children
  return hostProps
}

function detachHostChildIfPresent(children: RuntimeHostChild[], child: RuntimeHostChild): void {
  const currentIndex = children.indexOf(child)
  if (currentIndex !== -1) {
    children.splice(currentIndex, 1)
  }
}

function requireHostChildIndex(children: RuntimeHostChild[], child: RuntimeHostChild): number {
  const currentIndex = children.indexOf(child)
  if (currentIndex === -1) {
    throw new Error("Expected host child to exist in parent.")
  }

  return currentIndex
}
