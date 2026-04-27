import { createContext, type ReactNode } from "react"
import Reconciler from "react-reconciler"
import { DefaultEventPriority, LegacyRoot } from "react-reconciler/constants"
import type { ExtensionRuntimeEvent } from "../../shared/extension-runtime-protocol"
import type { ExtensionHostElementType } from "../sdk/host-elements"
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
  render: (element: ReactNode) => void
}

export function createExtensionRuntimeRenderer(
  context: RuntimeSnapshotContext,
  params: {
    onSnapshot?: (snapshot: ReturnType<typeof createSurfaceSnapshot>) => void
  } = {}
): ExtensionRuntimeRenderer {
  let snapshotQueued = false
  const container = createHostContainer({
    context,
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
      if (event.type !== "action.execute") {
        return false
      }

      if (event.revision !== container.latestSnapshot?.revision) {
        return false
      }

      const action = container.actionHandlers.get(event.actionId)
      if (!action) {
        return false
      }

      await runtimeReconciler.flushSyncFromReconciler(() => action.handler())
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
    render(element) {
      runtimeReconciler.updateContainerSync(element, root, null, null)
      runtimeReconciler.flushPassiveEffects()
    }
  }
}

async function flushSnapshotQueue(): Promise<void> {
  await Promise.resolve()
  runtimeReconciler.flushPassiveEffects()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  runtimeReconciler.flushPassiveEffects()
  await Promise.resolve()
}

function reportRuntimeError(error: Error): void {
  throw error
}
