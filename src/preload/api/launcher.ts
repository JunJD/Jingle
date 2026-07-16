import type { ClipboardContext } from "@shared/clipboard"
import type { LauncherSelectionContextSnapshot } from "@shared/launcher-selection"
import { launcherShownEventSchema, type LauncherShownEvent } from "@shared/launcher-presentation"
import type {
  LauncherActionExecutionResult,
  LauncherSearchAction,
  LauncherSearchRequest,
  LauncherSearchResponse
} from "@shared/launcher-search"
import { invokeIpc, ipcRenderer } from "../ipc"

export interface LauncherShownCallbackEvent extends LauncherShownEvent {
  deadlineAt: number
  isCurrent: () => boolean
}

type LauncherShownCallback = (event: LauncherShownCallbackEvent) => Promise<void> | void

const LAUNCHER_PRESENTATION_BUDGET_MS = 450
const launcherShownCallbacks = new Set<LauncherShownCallback>()
const launcherPresentationReadyWaiters = new Set<() => void>()
let activeLauncherPresentationController: AbortController | null = null
let latestLauncherPresentationId = 0
let rendererPresentationReady = false

function isCurrentLauncherPresentation(event: LauncherShownEvent, signal: AbortSignal): boolean {
  return !signal.aborted && event.presentationId === latestLauncherPresentationId
}

function setRendererPresentationReady(ready: boolean): void {
  rendererPresentationReady = ready
  if (!ready) {
    activeLauncherPresentationController?.abort()
    return
  }

  for (const resolve of Array.from(launcherPresentationReadyWaiters)) {
    resolve()
  }
}

function waitForRendererPresentationReady(deadline: number, signal: AbortSignal): Promise<boolean> {
  if (rendererPresentationReady) {
    return Promise.resolve(true)
  }

  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0 || signal.aborted) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (ready: boolean): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      launcherPresentationReadyWaiters.delete(handleReady)
      signal.removeEventListener("abort", handleAbort)
      resolve(ready)
    }
    const handleReady = (): void => finish(true)
    const handleAbort = (): void => finish(false)

    launcherPresentationReadyWaiters.add(handleReady)
    signal.addEventListener("abort", handleAbort, { once: true })
    timeout = setTimeout(() => finish(false), remainingMs)

    if (signal.aborted) {
      handleAbort()
    } else if (rendererPresentationReady) {
      handleReady()
    }
  })
}

function waitForAnimationFrame(deadline: number, signal: AbortSignal): Promise<boolean> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0 || signal.aborted) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (completed: boolean): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      cancelAnimationFrame(frameId)
      signal.removeEventListener("abort", handleAbort)
      resolve(completed)
    }
    const handleAbort = (): void => finish(false)
    const frameId = requestAnimationFrame(() => finish(true))

    signal.addEventListener("abort", handleAbort, { once: true })
    timeout = setTimeout(() => finish(false), remainingMs)
    if (signal.aborted) {
      handleAbort()
    }
  })
}

async function settleLauncherShownCallbacks(
  event: LauncherShownCallbackEvent,
  deadline: number,
  signal: AbortSignal
): Promise<boolean> {
  const callbacks = Array.from(launcherShownCallbacks)
  if (callbacks.length === 0) {
    console.error("[launcher] renderer reported ready without shown subscribers")
    return false
  }

  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0 || signal.aborted) {
    return false
  }

  const resultsPromise = Promise.allSettled(
    callbacks.map((callback) => Promise.resolve().then(() => callback(event)))
  )
  const outcome = await new Promise<
    | { status: "aborted" }
    | { status: "settled"; results: PromiseSettledResult<void>[] }
    | { status: "timed-out" }
  >((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (
      result:
        | { status: "aborted" }
        | { status: "settled"; results: PromiseSettledResult<void>[] }
        | { status: "timed-out" }
    ): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      signal.removeEventListener("abort", handleAbort)
      resolve(result)
    }
    const handleAbort = (): void => finish({ status: "aborted" })

    signal.addEventListener("abort", handleAbort, { once: true })
    timeout = setTimeout(() => finish({ status: "timed-out" }), remainingMs)
    void resultsPromise.then((results) => finish({ results, status: "settled" }))
    if (signal.aborted) {
      handleAbort()
    }
  })

  if (outcome.status === "aborted") {
    return false
  }
  if (outcome.status === "timed-out") {
    console.error("[launcher] shown callbacks timed out", {
      presentationId: event.presentationId
    })
    return false
  }

  const { results } = outcome
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[launcher] shown callback failed", result.reason)
    }
  }

  return true
}

async function invokeLauncherPresentUntilDeadline(
  event: LauncherShownEvent,
  deadline: number,
  signal: AbortSignal
): Promise<void> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0 || signal.aborted) {
    return
  }

  const invokePromise = invokeIpc("launcher:present", event.presentationId).then(
    () => ({ status: "settled" as const }),
    (error: unknown) => ({ error, status: "failed" as const })
  )
  const outcome = await new Promise<
    | { status: "aborted" }
    | { error: unknown; status: "failed" }
    | { status: "settled" }
    | { status: "timed-out" }
  >((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (
      result:
        | { status: "aborted" }
        | { error: unknown; status: "failed" }
        | { status: "settled" }
        | { status: "timed-out" }
    ): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      signal.removeEventListener("abort", handleAbort)
      resolve(result)
    }
    const handleAbort = (): void => finish({ status: "aborted" })

    signal.addEventListener("abort", handleAbort, { once: true })
    timeout = setTimeout(() => finish({ status: "timed-out" }), remainingMs)
    void invokePromise.then(finish)
    if (signal.aborted) {
      handleAbort()
    }
  })

  if (outcome.status === "failed") {
    throw outcome.error
  }
  if (outcome.status === "timed-out") {
    console.error("[launcher] present acknowledgement timed out", {
      presentationId: event.presentationId
    })
  }
}

async function presentLauncherAfterShownCallbacks(
  event: LauncherShownEvent,
  signal: AbortSignal
): Promise<void> {
  const deadline = Date.now() + LAUNCHER_PRESENTATION_BUDGET_MS
  const callbackEvent: LauncherShownCallbackEvent = {
    ...event,
    deadlineAt: deadline,
    isCurrent: () => Date.now() < deadline && isCurrentLauncherPresentation(event, signal)
  }
  const ready = await waitForRendererPresentationReady(deadline, signal)
  if (!ready || !isCurrentLauncherPresentation(event, signal)) {
    return
  }

  // Let the ready commit finish before snapshotting all critical subscribers.
  if (!(await waitForAnimationFrame(deadline, signal))) {
    return
  }
  if (!isCurrentLauncherPresentation(event, signal)) {
    return
  }

  const callbacksSettled = await settleLauncherShownCallbacks(callbackEvent, deadline, signal)
  if (!callbacksSettled || !isCurrentLauncherPresentation(event, signal)) {
    return
  }

  if (!(await waitForAnimationFrame(deadline, signal))) {
    return
  }
  if (!isCurrentLauncherPresentation(event, signal)) {
    return
  }
  if (!(await waitForAnimationFrame(deadline, signal))) {
    return
  }
  if (!isCurrentLauncherPresentation(event, signal)) {
    return
  }
  await invokeLauncherPresentUntilDeadline(event, deadline, signal)
}

ipcRenderer.on("launcher:shown", (_ipcEvent, rawEvent: unknown) => {
  const parsedEvent = launcherShownEventSchema.safeParse(rawEvent)
  if (!parsedEvent.success) {
    console.error("[launcher] invalid shown event", parsedEvent.error)
    return
  }

  const event = parsedEvent.data
  if (event.presentationId <= latestLauncherPresentationId) {
    return
  }

  latestLauncherPresentationId = event.presentationId
  activeLauncherPresentationController?.abort()
  const controller = new AbortController()
  activeLauncherPresentationController = controller
  void presentLauncherAfterShownCallbacks(event, controller.signal)
    .catch((error: unknown) => {
      console.error("[launcher] failed to present the window", error)
    })
    .finally(() => {
      if (activeLauncherPresentationController === controller) {
        activeLauncherPresentationController = null
      }
    })
})

export const launcherApi = {
  getClipboardContext: (): Promise<ClipboardContext> => {
    return invokeIpc("launcher:getClipboardContext")
  },
  getSelectionContext: (): Promise<LauncherSelectionContextSnapshot> => {
    return invokeIpc("launcher:getSelectionContext")
  },
  clearSelectionContext: (id?: string): Promise<void> => {
    return invokeIpc("launcher:clearSelectionContext", id)
  },
  search: (request: LauncherSearchRequest): Promise<LauncherSearchResponse> => {
    return invokeIpc("launcher:search", request)
  },
  executeAction: (action: LauncherSearchAction): Promise<LauncherActionExecutionResult> => {
    return invokeIpc("launcher:executeAction", action)
  },
  show: (): Promise<void> => {
    return invokeIpc("launcher:show")
  },
  hide: (): Promise<void> => {
    return invokeIpc("launcher:hide")
  },
  setViewportHeight: (height: number): Promise<void> => {
    return invokeIpc("launcher:setViewportHeight", height)
  },
  setPresentationReady: (ready: boolean): void => {
    setRendererPresentationReady(ready)
  },
  onShown: (callback: LauncherShownCallback): (() => void) => {
    launcherShownCallbacks.add(callback)
    return () => {
      launcherShownCallbacks.delete(callback)
    }
  },
  onSelectionContextUpdated: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }

    ipcRenderer.on("launcher:selection-context-updated", handler)
    return () => {
      ipcRenderer.removeListener("launcher:selection-context-updated", handler)
    }
  },
  onSearchIndexUpdated: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }

    ipcRenderer.on("launcher:search-index-updated", handler)
    return () => {
      ipcRenderer.removeListener("launcher:search-index-updated", handler)
    }
  }
}
