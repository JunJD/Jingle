import { Fragment, useEffect, useId, useState, type RefObject } from "react"
import type { LauncherInputStatus } from "../launcher-input-status"

type GlowBounds = {
  height: number
  radius: number
  width: number
}

type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right"

interface GlowLayer {
  readonly blur: number
  readonly duration: string
  readonly from: number
  readonly id: string
  readonly opacity: number
  readonly strokeWidth: number
}

interface GlowTuning {
  readonly armScale: number
  readonly containerOpacity: number
  readonly perimeterOpacity: number
  readonly strokeScale: number
  readonly strokeOpacity: number
}

// Bias the stroke outward so the shell reads as emitting glow instead of gaining an inner border.
const INNER_STROKE_INSET = -4

const GLOW_LAYERS: readonly GlowLayer[] = [
  {
    blur: 0,
    duration: "6.8s",
    from: 0,
    id: "core",
    opacity: 0.94,
    strokeWidth: 2.5
  },
  {
    blur: 4,
    duration: "8.6s",
    from: 360,
    id: "soft",
    opacity: 0.76,
    strokeWidth: 6
  },
  {
    blur: 10,
    duration: "11.8s",
    from: 120,
    id: "halo",
    opacity: 0.48,
    strokeWidth: 10.5
  },
  {
    blur: 15,
    duration: "14.6s",
    from: 0,
    id: "bloom",
    opacity: 0.28,
    strokeWidth: 15
  }
] as const

const CORNERS: Corner[] = ["top-left", "top-right", "bottom-right", "bottom-left"]
const GLOW_TUNING: Record<LauncherInputStatus, GlowTuning> = {
  idle: {
    armScale: 0.84,
    containerOpacity: 0.64,
    perimeterOpacity: 0.34,
    strokeOpacity: 0.72,
    strokeScale: 0.92
  },
  pending: {
    armScale: 1.08,
    containerOpacity: 1,
    perimeterOpacity: 0.82,
    strokeOpacity: 1.08,
    strokeScale: 1.05
  },
  tooling: {
    armScale: 1.22,
    containerOpacity: 1,
    perimeterOpacity: 0.94,
    strokeOpacity: 1.16,
    strokeScale: 1.12
  }
}

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

function resolveRectGeometry(
  bounds: GlowBounds,
  inset: number
): {
  readonly height: number
  readonly radius: number
  readonly width: number
  readonly x: number
  readonly y: number
} {
  const width = bounds.width - inset * 2
  const height = bounds.height - inset * 2

  return {
    height,
    radius: Math.max(bounds.radius - inset, 0),
    width,
    x: inset,
    y: inset
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
  const baseArmLength = Math.max(30, Math.min(Math.min(bounds.width, bounds.height) * 0.135, 68))
  const tuning = GLOW_TUNING[status]

  return (
    <div
      aria-hidden="true"
      className="launcher-shell-intelligence-glow"
      data-status={status}
      style={{ opacity: tuning.containerOpacity }}
    >
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
                    height="240%"
                    id={filterId}
                    width="240%"
                    x="-70%"
                    y="-70%"
                  >
                    <feGaussianBlur stdDeviation={layer.blur} />
                  </filter>
                ) : null}
              </Fragment>
            )
          })}
        </defs>

        {GLOW_LAYERS.map((layer) => {
          const strokeWidth = layer.strokeWidth * tuning.strokeScale
          const inset = INNER_STROKE_INSET + strokeWidth / 2
          const layerArmLength = baseArmLength * tuning.armScale + strokeWidth * 1.2
          const rect = resolveRectGeometry(bounds, inset)
          const perimeterOpacity = Math.min(layer.opacity * tuning.perimeterOpacity, 1)
          const strokeOpacity = Math.min(layer.opacity * tuning.strokeOpacity, 1)

          return (
            <g
              key={layer.id}
              className={`launcher-shell-intelligence-glow-stroke launcher-shell-intelligence-glow-stroke--${layer.id}`}
              filter={layer.blur > 0 ? `url(#${gradientPrefix}-${layer.id}-blur)` : undefined}
            >
              <rect
                fill="none"
                height={rect.height}
                opacity={perimeterOpacity}
                rx={rect.radius}
                ry={rect.radius}
                stroke={`url(#${gradientPrefix}-${layer.id}-gradient)`}
                strokeLinejoin="round"
                strokeWidth={strokeWidth}
                width={rect.width}
                x={rect.x}
                y={rect.y}
              />
              {CORNERS.map((corner) => (
                <path
                  key={corner}
                  d={buildCornerPath(corner, bounds, inset, layerArmLength)}
                  fill="none"
                  opacity={strokeOpacity}
                  stroke={`url(#${gradientPrefix}-${layer.id}-gradient)`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={strokeWidth}
                />
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
