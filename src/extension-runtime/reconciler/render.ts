import { createContext, type ReactNode } from "react"
import Reconciler from "react-reconciler"
import { DefaultEventPriority, LegacyRoot } from "react-reconciler/constants"
import type { ExtensionRuntimeEvent } from "../../shared/extension-runtime-protocol"
import {
  ExtensionHostElement,
  type ExtensionHostElementType,
  type RuntimeToastActionHandler,
  type RuntimeToastActionRegistration
} from "@openwork/extension-api/host-runtime"
import {
  appendHostChild,
  createHostContainer,
  createHostElement,
  createHostText,
  insertHostChildBefore,
  removeHostChild,
  updateHostElementProps,
  type RuntimeHostChild,
  type RuntimeHostContainer,
  type RuntimeHostElementNode,
  type RuntimeHostProps,
  type RuntimeHostRequestHandler,
  type RuntimeHostTextNode,
  type RuntimeSnapshotContext
} from "./host-tree"
import { createSurfaceSnapshot } from "./snapshot"

type HostConfig = Parameters<typeof Reconciler>[0]
type RuntimeHostContext = Record<string, never>
type RuntimeHostConfig = HostConfig & {
  maySuspendCommitInSyncRender: () => boolean
  maySuspendCommitOnUpdate: () => boolean
}

let currentUpdatePriority = DefaultEventPriority

function createHostTransitionContext(): HostConfig["HostTransitionContext"] {
  return createContext(null) as unknown as HostConfig["HostTransitionContext"]
}

function noop(): void {
  return undefined
}

const hostConfig: RuntimeHostConfig = {
  HostTransitionContext: createHostTransitionContext(),
  NotPendingTransition: null,
  afterActiveInstanceBlur: noop,
  appendChild(parent, child) {
    appendHostChild(parent as RuntimeHostElementNode, child as RuntimeHostChild)
  },
  appendChildToContainer(container, child) {
    appendHostChild(container as RuntimeHostContainer, child as RuntimeHostChild)
  },
  appendInitialChild(parent, child) {
    appendHostChild(parent as RuntimeHostElementNode, child as RuntimeHostChild)
  },
  beforeActiveInstanceBlur: noop,
  cancelTimeout(id) {
    clearTimeout(id as ReturnType<typeof setTimeout>)
  },
  clearContainer(container) {
    ;(container as RuntimeHostContainer).children = []
  },
  commitTextUpdate(textInstance, _oldText, newText) {
    ;(textInstance as RuntimeHostTextNode).text = newText
  },
  commitUpdate(instance, _type, _prevProps, nextProps) {
    updateHostElementProps(instance as RuntimeHostElementNode, nextProps as RuntimeHostProps)
  },
  createInstance(type, props) {
    return createHostElement(
      type as ExtensionHostElementType,
      props as RuntimeHostProps
    ) as unknown as never
  },
  createTextInstance(text) {
    return createHostText(text) as unknown as never
  },
  detachDeletedInstance: noop,
  finalizeInitialChildren() {
    return false
  },
  getChildHostContext(parentHostContext) {
    return parentHostContext
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority
  },
  getInstanceFromNode() {
    return null
  },
  getInstanceFromScope() {
    return null
  },
  getPublicInstance(instance) {
    return instance
  },
  getRootHostContext() {
    return {} as RuntimeHostContext
  },
  hideInstance: noop,
  hideTextInstance: noop,
  insertBefore(parent, child, beforeChild) {
    insertHostChildBefore(
      parent as RuntimeHostElementNode,
      child as RuntimeHostChild,
      beforeChild as RuntimeHostChild
    )
  },
  insertInContainerBefore(container, child, beforeChild) {
    insertHostChildBefore(
      container as RuntimeHostContainer,
      child as RuntimeHostChild,
      beforeChild as RuntimeHostChild
    )
  },
  isPrimaryRenderer: false,
  maySuspendCommit() {
    return false
  },
  maySuspendCommitInSyncRender() {
    return false
  },
  maySuspendCommitOnUpdate() {
    return false
  },
  noTimeout: -1,
  prepareForCommit() {
    return null
  },
  preparePortalMount: noop,
  prepareScopeUpdate: noop,
  preloadInstance() {
    return true
  },
  removeChild(parent, child) {
    removeHostChild(parent as RuntimeHostElementNode, child as RuntimeHostChild)
  },
  removeChildFromContainer(container, child) {
    removeHostChild(container as RuntimeHostContainer, child as RuntimeHostChild)
  },
  requestPostPaintCallback(callback) {
    setTimeout(() => callback(performance.now()), 0)
  },
  resetAfterCommit(container) {
    ;(container as RuntimeHostContainer).onCommit()
  },
  resetFormInstance: noop,
  resetTextContent(instance) {
    ;(instance as RuntimeHostElementNode).children = []
  },
  resolveEventTimeStamp() {
    return performance.now()
  },
  resolveEventType() {
    return null
  },
  resolveUpdatePriority() {
    return DefaultEventPriority
  },
  scheduleMicrotask(queueTask) {
    queueMicrotask(queueTask)
  },
  scheduleTimeout(fn, delay) {
    return setTimeout(fn, delay)
  },
  setCurrentUpdatePriority(newPriority) {
    currentUpdatePriority = newPriority
  },
  shouldAttemptEagerTransition() {
    return false
  },
  shouldSetTextContent() {
    return false
  },
  startSuspendingCommit: noop,
  supportsHydration: false,
  supportsMicrotasks: true,
  supportsMutation: true,
  supportsPersistence: false,
  suspendInstance: noop,
  trackSchedulerEvent: noop,
  unhideInstance: noop,
  unhideTextInstance: noop,
  waitForCommitToBeReady() {
    return null
  },
  warnsIfNotActing: false
}

const runtimeReconciler = Reconciler(hostConfig)

export interface ExtensionRuntimeRenderer {
  dispatchEvent: (event: ExtensionRuntimeEvent) => Promise<boolean>
  flushSnapshots: () => Promise<void>
  getSnapshot: () => ReturnType<typeof createSurfaceSnapshot> | null
  getSnapshots: () => ReturnType<typeof createSurfaceSnapshot>[]
  registerToastAction: (handler: RuntimeToastActionHandler) => RuntimeToastActionRegistration
  render: (element: ReactNode) => void
}

export function createExtensionRuntimeRenderer(
  context: RuntimeSnapshotContext,
  params: {
    onHostRequest?: RuntimeHostRequestHandler
    onSnapshot?: (snapshot: ReturnType<typeof createSurfaceSnapshot>) => void
  } = {}
): ExtensionRuntimeRenderer {
  let snapshotQueued = false
  const container = createHostContainer({
    context,
    requestHost: params.onHostRequest,
    onCommit: () => {
      if (snapshotQueued) {
        return
      }

      snapshotQueued = true
      queueMicrotask(() => {
        snapshotQueued = false
        container.revision += 1
        const snapshot = createSurfaceSnapshot(container)
        container.latestSnapshot = snapshot
        container.snapshots.push(snapshot)
        params.onSnapshot?.(snapshot)
      })
    }
  })
  const root = runtimeReconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    "openwork-extension-runtime",
    reportRuntimeError,
    reportRuntimeError,
    reportRuntimeError,
    () => {}
  )

  return {
    async dispatchEvent(event) {
      if (event.type === "form.field.change") {
        return dispatchFormFieldChange(container, event.fieldId, event.value)
      }

      if (event.type === "list.query.change") {
        return dispatchListChange(container, "onSearchTextChange", event.query)
      }

      if (event.type === "list.dropdown.change") {
        return dispatchListDropdownChange(container, event.value)
      }

      if (event.type === "form.dropdown.search") {
        return dispatchFormDropdownSearch(container, event.fieldId, event.query)
      }

      if (event.type === "list.pagination.load-more") {
        return dispatchListPaginationLoadMore(container)
      }

      if (event.type === "navigation.pop") {
        return dispatchNavigationPop(container)
      }

      if (event.type === "menu-bar.item.execute") {
        return dispatchMenuBarItem(container, event.itemId)
      }

      if (event.type === "toast.action.execute") {
        const action = container.toastActionHandlers.get(event.actionId)
        if (!action || action.disabled) {
          return false
        }

        await runRuntimeHandler(() => action.handler())
        runtimeReconciler.flushSyncWork()
        await flushSnapshotQueue()
        return true
      }

      if (event.type !== "action.execute") {
        return false
      }

      if (event.revision !== container.latestSnapshot?.revision) {
        return false
      }

      const action = container.actionHandlers.get(event.actionId)
      if (!action || action.disabled) {
        return false
      }

      await runRuntimeHandler(() => action.handler({ formValues: event.formValues }))
      runtimeReconciler.flushSyncWork()
      await flushSnapshotQueue()
      return true
    },
    async flushSnapshots() {
      runtimeReconciler.flushPassiveEffects()
      await flushSnapshotQueue()
    },
    getSnapshot() {
      return container.latestSnapshot
    },
    getSnapshots() {
      return container.snapshots
    },
    registerToastAction(handler) {
      const id = container.nextToastActionId()
      container.toastActionHandlers.set(id, {
        disabled: false,
        handler
      })
      return { id }
    },
    render(element) {
      runtimeReconciler.updateContainerSync(element, root, null, null)
      runtimeReconciler.flushPassiveEffects()
    }
  }
}

async function flushSnapshotQueue(): Promise<void> {
  await Promise.resolve()
  runtimeReconciler.flushPassiveEffects()
  runtimeReconciler.flushSyncWork()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  runtimeReconciler.flushPassiveEffects()
  runtimeReconciler.flushSyncWork()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  runtimeReconciler.flushPassiveEffects()
  runtimeReconciler.flushSyncWork()
  await Promise.resolve()
}

async function dispatchFormFieldChange(
  container: RuntimeHostContainer,
  fieldId: string,
  value: unknown
): Promise<boolean> {
  const form = findFirstHostElement(container.children, ExtensionHostElement.Form)
  const field = form ? findFormFieldById(form, fieldId) : null
  const handler = field?.props.onChange
  if (typeof handler !== "function") {
    return false
  }

  await runRuntimeHandler(() => handler(value))
  runtimeReconciler.flushSyncWork()
  await flushSnapshotQueue()
  return true
}

async function dispatchListChange(
  container: RuntimeHostContainer,
  handlerName: "onSearchTextChange",
  value: string
): Promise<boolean> {
  const list = findFirstHostElement(container.children, ExtensionHostElement.List)
  const handler = list?.props[handlerName]
  if (typeof handler !== "function") {
    return false
  }

  await runRuntimeHandler(() => handler(value))
  runtimeReconciler.flushSyncWork()
  await flushSnapshotQueue()
  return true
}

async function dispatchListPaginationLoadMore(container: RuntimeHostContainer): Promise<boolean> {
  const action = container.actionHandlers.get("list-pagination.load-more")
  if (!action || action.disabled) {
    return false
  }

  await runRuntimeHandler(() => action.handler())
  runtimeReconciler.flushSyncWork()
  await flushSnapshotQueue()
  return true
}

async function dispatchNavigationPop(container: RuntimeHostContainer): Promise<boolean> {
  const surface = findFirstSurfaceHostElement(container.children)
  const handler = surface?.props.onNavigationPop
  if (!surface?.props.navigationCanPop || typeof handler !== "function") {
    return false
  }

  await runRuntimeHandler(() => handler())
  runtimeReconciler.flushSyncWork()
  await flushSnapshotQueue()
  return true
}

async function dispatchListDropdownChange(
  container: RuntimeHostContainer,
  value: string
): Promise<boolean> {
  const list = findFirstHostElement(container.children, ExtensionHostElement.List)
  const dropdown = list
    ? findDirectHostElement(list.children, ExtensionHostElement.ListDropdown)
    : null
  const handler = dropdown?.props.onChange
  if (typeof handler !== "function") {
    return false
  }

  await runRuntimeHandler(() => handler(value))
  runtimeReconciler.flushSyncWork()
  await flushSnapshotQueue()
  return true
}

async function dispatchFormDropdownSearch(
  container: RuntimeHostContainer,
  fieldId: string,
  query: string
): Promise<boolean> {
  const form = findFirstHostElement(container.children, ExtensionHostElement.Form)
  const field = form ? findFormFieldById(form, fieldId) : null
  if (field?.type !== ExtensionHostElement.FormDropdown) {
    return false
  }

  const handler = field.props.onSearchTextChange
  if (typeof handler !== "function") {
    return false
  }

  await runRuntimeHandler(() => handler(query))
  runtimeReconciler.flushSyncWork()
  await flushSnapshotQueue()
  return true
}

async function dispatchMenuBarItem(
  container: RuntimeHostContainer,
  itemId: string
): Promise<boolean> {
  const handler = container.menuBarActionHandlers.get(itemId)
  if (!handler || handler.disabled) {
    return false
  }

  await runRuntimeHandler(() => handler.handler())
  runtimeReconciler.flushSyncWork()
  await flushSnapshotQueue()
  return true
}

async function runRuntimeHandler(handler: () => Promise<unknown> | unknown): Promise<void> {
  let result: Promise<unknown> | unknown
  runtimeReconciler.flushSyncFromReconciler(() => {
    result = handler()
  })
  await result
}

function findFirstHostElement(
  children: RuntimeHostChild[],
  type: ExtensionHostElementType
): RuntimeHostElementNode | null {
  for (const child of children) {
    if (child.kind !== "element") {
      continue
    }

    if (child.type === type) {
      return child
    }

    const nested = findFirstHostElement(child.children, type)
    if (nested) {
      return nested
    }
  }

  return null
}

function findDirectHostElement(
  children: RuntimeHostChild[],
  type: ExtensionHostElementType
): RuntimeHostElementNode | null {
  return (
    children.find(
      (child): child is RuntimeHostElementNode => child.kind === "element" && child.type === type
    ) ?? null
  )
}

function findFirstSurfaceHostElement(children: RuntimeHostChild[]): RuntimeHostElementNode | null {
  for (const child of children) {
    if (child.kind !== "element") {
      continue
    }

    if (
      child.type === ExtensionHostElement.Detail ||
      child.type === ExtensionHostElement.Form ||
      child.type === ExtensionHostElement.List
    ) {
      return child
    }

    const nested = findFirstSurfaceHostElement(child.children)
    if (nested) {
      return nested
    }
  }

  return null
}

function findFormFieldById(
  form: RuntimeHostElementNode,
  fieldId: string
): RuntimeHostElementNode | null {
  let fieldIndex = 0

  for (const child of directHostElementChildren(form)) {
    if (!isFormFieldElement(child)) {
      continue
    }

    const id = typeof child.props.id === "string" ? child.props.id : `form-field-${fieldIndex}`
    fieldIndex += 1

    if (id === fieldId) {
      return child
    }
  }

  return null
}

function isFormFieldElement(node: RuntimeHostElementNode): boolean {
  return (
    node.type === ExtensionHostElement.FormCheckbox ||
    node.type === ExtensionHostElement.FormDatePicker ||
    node.type === ExtensionHostElement.FormDropdown ||
    node.type === ExtensionHostElement.FormSeparator ||
    node.type === ExtensionHostElement.FormTagPicker ||
    node.type === ExtensionHostElement.FormTextArea ||
    node.type === ExtensionHostElement.FormTextField
  )
}

function directHostElementChildren(node: RuntimeHostElementNode): RuntimeHostElementNode[] {
  return node.children.filter((child): child is RuntimeHostElementNode => child.kind === "element")
}

function reportRuntimeError(error: Error): void {
  throw error
}
