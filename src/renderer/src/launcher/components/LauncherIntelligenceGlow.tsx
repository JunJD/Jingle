import { Fragment, useEffect, useId, useState, type RefObject } from "react"
import type { LauncherInputStatus } from "../launcher-input-status"

type GlowBounds = {
  height: number
  radius: number
  width: number
}

type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right"

// Bias the stroke outward so the shell reads as emitting glow instead of gaining an inner border.
const INNER_STROKE_INSET = -4

const GLOW_LAYERS = [
  {
    blur: 0,
    duration: "7.6s",
    from: 0,
    id: "crisp",
    opacity: 0.94,
    strokeWidth: 1.5
  },
  {
    blur: 6,
    duration: "10.2s",
    from: 360,
    id: "soft",
    opacity: 0.6,
    strokeWidth: 4.5
  },
  {
    blur: 12,
    duration: "13.6s",
    from: 0,
    id: "ambient",
    opacity: 0.34,
    strokeWidth: 8
  }
] as const

const CORNERS: Corner[] = ["top-left", "top-right", "bottom-right", "bottom-left"]

function resolveRadius(styles: CSSStyleDeclaration): number {
  const shellRadius = Number.parseFloat(styles.borderTopLeftRadius)
  if (!Number.isNaN(shellRadius) && shellRadius > 0) {
    return shellRadius
  }

  const nativeRadius = Number.parseFloat(styles.getPropertyValue("--launcher-shell-native-radius"))
  if (!Number.isNaN(nativeRadius)) {
    return nativeRadius
  }

  return Number.isNaN(shellRadius) ? 0 : shellRadius
}

function readBounds(target: HTMLElement): GlowBounds {
  const { width, height } = target.getBoundingClientRect()
  const styles = window.getComputedStyle(target)
  const radius = resolveRadius(styles)

  return {
    height: Math.round(height),
    radius,
    width: Math.round(width)
  }
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handleChange = (event: MediaQueryListEvent): void => {
      setReducedMotion(event.matches)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  return reducedMotion
}

function buildCornerPath(
  corner: Corner,
  bounds: GlowBounds,
  inset: number,
  armLength: number
): string {
  const maxX = bounds.width - inset
  const maxY = bounds.height - inset
  const minX = inset
  const minY = inset
  const radius = Math.max(bounds.radius - inset, 0)

  switch (corner) {
    case "top-left":
      return `M ${minX} ${minY + radius + armLength} L ${minX} ${minY + radius} Q ${minX} ${minY} ${minX + radius} ${minY} L ${minX + radius + armLength} ${minY}`
    case "top-right":
      return `M ${maxX - radius - armLength} ${minY} L ${maxX - radius} ${minY} Q ${maxX} ${minY} ${maxX} ${minY + radius} L ${maxX} ${minY + radius + armLength}`
    case "bottom-right":
      return `M ${maxX} ${maxY - radius - armLength} L ${maxX} ${maxY - radius} Q ${maxX} ${maxY} ${maxX - radius} ${maxY} L ${maxX - radius - armLength} ${maxY}`
    case "bottom-left":
      return `M ${minX + radius + armLength} ${maxY} L ${minX + radius} ${maxY} Q ${minX} ${maxY} ${minX} ${maxY - radius} L ${minX} ${maxY - radius - armLength}`
  }
}

export function LauncherIntelligenceGlow(props: {
  status: LauncherInputStatus
  targetRef: RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  const { status, targetRef } = props
  const [bounds, setBounds] = useState<GlowBounds | null>(null)
  const reducedMotion = useReducedMotion()
  const gradientPrefix = useId().replace(/:/g, "")

  useEffect(() => {
    const target = targetRef.current
    if (!target) {
      return
    }

    const updateBounds = (): void => {
      setBounds(readBounds(target))
    }

    updateBounds()

    const observer = new ResizeObserver(() => {
      updateBounds()
    })

    observer.observe(target)

    return () => observer.disconnect()
  }, [targetRef])

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const centerX = bounds.width / 2
  const centerY = bounds.height / 2
  const armLength = Math.max(44, Math.min(Math.min(bounds.width, bounds.height) * 0.18, 92))
  const intensity = status === "running" ? 1.28 : status === "pending" ? 1.08 : 1

  return (
    <div aria-hidden="true" className="launcher-shell-intelligence-glow" data-status={status}>
      <svg
        className="launcher-shell-intelligence-glow-svg"
        preserveAspectRatio="none"
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
      >
        <defs>
          {GLOW_LAYERS.map((layer) => {
            const gradientId = `${gradientPrefix}-${layer.id}-gradient`
            const filterId = `${gradientPrefix}-${layer.id}-blur`

            return (
              <Fragment key={layer.id}>
                <linearGradient
                  gradientUnits="userSpaceOnUse"
                  id={gradientId}
                  x1="0"
                  x2={bounds.width}
                  y1="0"
                  y2="0"
                >
                  <stop offset="0%" stopColor="rgba(255, 107, 124, 1)" />
                  <stop offset="18%" stopColor="rgba(255, 191, 127, 1)" />
                  <stop offset="38%" stopColor="rgba(163, 150, 255, 1)" />
                  <stop offset="58%" stopColor="rgba(247, 169, 229, 1)" />
                  <stop offset="78%" stopColor="rgba(121, 177, 255, 1)" />
                  <stop offset="100%" stopColor="rgba(255, 107, 124, 1)" />
                  {reducedMotion ? null : (
                    <animateTransform
                      attributeName="gradientTransform"
                      dur={layer.duration}
                      from={`${layer.from} ${centerX} ${centerY}`}
                      repeatCount="indefinite"
                      to={`${layer.from + 360} ${centerX} ${centerY}`}
                      type="rotate"
                    />
                  )}
                </linearGradient>
                {layer.blur > 0 ? (
                  <filter
                    colorInterpolationFilters="sRGB"
                    height="160%"
                    id={filterId}
                    width="160%"
                    x="-30%"
                    y="-30%"
                  >
                    <feGaussianBlur stdDeviation={layer.blur} />
                  </filter>
                ) : null}
              </Fragment>
            )
          })}
        </defs>

        {GLOW_LAYERS.map((layer) => {
          const inset = INNER_STROKE_INSET + layer.strokeWidth / 2
          const layerArmLength = armLength + layer.strokeWidth * 1.8 * intensity

          return (
            <g
              key={layer.id}
              className={`launcher-shell-intelligence-glow-stroke launcher-shell-intelligence-glow-stroke--${layer.id}`}
              filter={layer.blur > 0 ? `url(#${gradientPrefix}-${layer.id}-blur)` : undefined}
              opacity={Math.min(layer.opacity * intensity, 1)}
            >
              {CORNERS.map((corner) => (
                <path
                  key={corner}
                  d={buildCornerPath(corner, bounds, inset, layerArmLength)}
                  fill="none"
                  stroke={`url(#${gradientPrefix}-${layer.id}-gradient)`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={layer.strokeWidth}
                />
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
