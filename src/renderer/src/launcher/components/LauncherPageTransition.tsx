import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type { LauncherNavigationDirection } from "../pages/types"

const TRANSITION_DURATION_MS = 170

export function LauncherPageTransition(props: {
  children: ReactNode
  direction: LauncherNavigationDirection
  pageKey: string
}): React.JSX.Element {
  const { children, direction, pageKey } = props
  const pageRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const pageElement = pageRef.current
    if (!pageElement) {
      return
    }

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (reducedMotionQuery.matches) {
      return
    }

    const animation = pageElement.animate(
      [
        {
          opacity: direction === "forward" ? 0.72 : 0.8,
          transform: "translate3d(0, 0, 0)"
        },
        {
          opacity: 1,
          transform: "translate3d(0, 0, 0)"
        }
      ],
      {
        duration: TRANSITION_DURATION_MS,
        easing: "cubic-bezier(0.2, 0.9, 0.24, 1)",
        fill: "both"
      }
    )

    return () => {
      animation.cancel()
    }
  }, [direction, pageKey])

  return (
    <div ref={pageRef} className="h-full w-full">
      {children}
    </div>
  )
}
