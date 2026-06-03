"use client"

import { cn } from "@/lib/utils"

export type TextShimmerProps = React.HTMLAttributes<HTMLElement> & {
  as?: keyof React.JSX.IntrinsicElements
  duration?: number
  spread?: number
}

export function TextShimmer(props: TextShimmerProps): React.JSX.Element {
  const { as = "span", children, className, duration = 4, spread = 20, style, ...rest } = props
  const dynamicSpread = Math.min(Math.max(spread, 5), 45)
  const Component = as as React.ElementType

  return (
    <Component
      className={cn("ow-text-shimmer font-medium", className)}
      style={{
        backgroundImage: `linear-gradient(to right, var(--ow-text-shimmer-base, var(--muted-foreground)) ${50 - dynamicSpread}%, var(--ow-text-shimmer-highlight, var(--foreground)) 50%, var(--ow-text-shimmer-base, var(--muted-foreground)) ${50 + dynamicSpread}%)`,
        ...style,
        animationDuration: `${duration}s`
      }}
      {...rest}
    >
      {children}
    </Component>
  )
}
