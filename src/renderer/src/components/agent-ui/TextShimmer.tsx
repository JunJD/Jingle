"use client"

import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"

function getNodeText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map(getNodeText).join("")
  }

  return ""
}

export interface TextShimmerProps extends Omit<React.ComponentProps<"span">, "children"> {
  active?: boolean
  children?: ReactNode
  delay?: number
  duration?: number
  offset?: number
  shimmerText?: string
  swap?: number
  text?: string
}

function TextShimmerComponent(props: TextShimmerProps): React.JSX.Element {
  const {
    active = true,
    children,
    className,
    delay = 0.6,
    duration = 4,
    offset = 0,
    shimmerText,
    style,
    swap = 0.22,
    text,
    ...rest
  } = props
  const resolvedText = useMemo(
    () => text ?? shimmerText ?? getNodeText(children),
    [children, shimmerText, text]
  )
  const [visible, setVisible] = useState(active)

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(active), active ? delay * 1000 : swap * 1000)

    return () => window.clearTimeout(timeout)
  }, [active, delay, swap])

  if (!resolvedText) {
    return (
      <span className={className} style={style} {...rest}>
        {children}
      </span>
    )
  }

  return (
    <span
      aria-label={resolvedText}
      className={className}
      data-active={visible ? "true" : "false"}
      data-component="ow-text-shimmer"
      style={
        {
          ...style,
          "--ow-text-shimmer-duration": `${duration}s`,
          "--ow-text-shimmer-index": offset,
          "--ow-text-shimmer-swap": `${swap}s`
        } as CSSProperties
      }
      {...rest}
    >
      <span aria-hidden="true" data-slot="ow-text-shimmer-char">
        <span data-slot="ow-text-shimmer-base">{resolvedText}</span>
        <span data-run={visible ? "true" : "false"} data-slot="ow-text-shimmer-highlight">
          {resolvedText}
        </span>
      </span>
    </span>
  )
}

export const TextShimmer = memo(TextShimmerComponent)
