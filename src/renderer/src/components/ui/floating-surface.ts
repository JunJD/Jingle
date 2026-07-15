import { useCallback, useRef, type Ref, type RefCallback } from "react"
import { getCurrentInputModality } from "@/lib/input-modality"

type FloatingSurfaceOpenState = "delayed-open" | "instant-open" | "open"
type RefCleanup = () => void

// Force-mounted Radix modal content can retain focus and scroll side effects while closed.
export type FloatingSurfacePrimitiveProps<Props> = Omit<Props, "forceMount"> & {
  forceMount?: never
}

export function withoutFloatingSurfaceForceMount<Props extends object>(
  props: Props
): Omit<Props, "forceMount"> {
  const forceMountFreeProps = { ...props } as Props & { forceMount?: unknown }
  delete forceMountFreeProps.forceMount
  return forceMountFreeProps
}

function isOpenState(state: string | null): state is FloatingSurfaceOpenState {
  return state === "open" || state === "delayed-open" || state === "instant-open"
}

function lockOpenCycleMotion(node: HTMLElement): void {
  const state = node.getAttribute("data-state")
  if (!isOpenState(state)) {
    return
  }

  const modality = getCurrentInputModality()
  node.dataset.jingleFloatingModality = modality
  node.dataset.jingleFloatingEnter =
    modality === "keyboard" || state === "instant-open" ? "instant" : "animated"
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): RefCleanup | undefined {
  if (typeof ref === "function") {
    const cleanup = ref(value)
    return typeof cleanup === "function" ? cleanup : undefined
  }

  if (ref) {
    ref.current = value
  }

  return undefined
}

function createClosedStateController(node: HTMLElement): {
  restore: () => void
  setClosed: (closed: boolean) => void
} {
  let snapshot: { ariaHidden: string | null; inert: boolean } | null = null

  const restore = (): void => {
    if (!snapshot) {
      return
    }

    if (snapshot.ariaHidden === null) {
      node.removeAttribute("aria-hidden")
    } else {
      node.setAttribute("aria-hidden", snapshot.ariaHidden)
    }

    node.inert = snapshot.inert
    snapshot = null
  }

  return {
    restore,
    setClosed(closed): void {
      if (!closed) {
        restore()
        return
      }

      if (snapshot) {
        return
      }

      snapshot = {
        ariaHidden: node.getAttribute("aria-hidden"),
        inert: node.inert
      }

      const activeElement = node.ownerDocument.activeElement
      if (activeElement instanceof HTMLElement && node.contains(activeElement)) {
        activeElement.blur()
      }

      node.inert = true
      node.setAttribute("aria-hidden", "true")
    }
  }
}

export function useFloatingSurfaceRef<T extends HTMLElement>(
  forwardedRef: Ref<T> | undefined
): RefCallback<T> {
  const cleanupRef = useRef<RefCleanup | null>(null)

  return useCallback(
    (node: T | null): RefCleanup | undefined => {
      const previousCleanup = cleanupRef.current
      previousCleanup?.()

      if (!node) {
        return previousCleanup ? undefined : assignRef(forwardedRef, null)
      }

      const closedState = createClosedStateController(node)
      let exitMarkerClearTimer: number | null = null
      let previousState = node.getAttribute("data-state")

      const scheduleExitMarkerClear = (): void => {
        if (exitMarkerClearTimer !== null) {
          window.clearTimeout(exitMarkerClearTimer)
        }

        exitMarkerClearTimer = window.setTimeout(() => {
          exitMarkerClearTimer = null
          if (isOpenState(node.getAttribute("data-state"))) {
            delete node.dataset.jingleFloatingExiting
          }
        }, 0)
      }

      if (isOpenState(previousState)) {
        const isReopening = node.dataset.jingleFloatingExiting !== undefined
        closedState.setClosed(false)
        if (!node.dataset.jingleFloatingModality || isReopening) {
          lockOpenCycleMotion(node)
        }
        if (isReopening) {
          scheduleExitMarkerClear()
        }
      } else {
        closedState.setClosed(true)
        node.dataset.jingleFloatingExiting = ""
      }

      const observer = new MutationObserver((records) => {
        const nextState = node.getAttribute("data-state")
        if (!isOpenState(nextState)) {
          closedState.setClosed(true)
          node.dataset.jingleFloatingExiting = ""
          previousState = nextState
          return
        }

        closedState.setClosed(false)
        const crossedClosedState = records.some(
          (record) => record.oldValue !== null && !isOpenState(record.oldValue)
        )
        if (!isOpenState(previousState) || crossedClosedState) {
          lockOpenCycleMotion(node)
        }
        scheduleExitMarkerClear()
        previousState = nextState
      })
      observer.observe(node, {
        attributeFilter: ["data-state"],
        attributeOldValue: true,
        attributes: true
      })

      const forwardedCleanup = assignRef(forwardedRef, node)
      let cleaned = false
      const cleanup = (): void => {
        if (cleaned) {
          return
        }
        cleaned = true

        if (cleanupRef.current === cleanup) {
          cleanupRef.current = null
        }
        if (exitMarkerClearTimer !== null) {
          window.clearTimeout(exitMarkerClearTimer)
        }
        observer.disconnect()
        closedState.restore()

        if (forwardedCleanup) {
          forwardedCleanup()
        } else {
          assignRef(forwardedRef, null)
        }
      }

      cleanupRef.current = cleanup
      return cleanup
    },
    [forwardedRef]
  )
}
