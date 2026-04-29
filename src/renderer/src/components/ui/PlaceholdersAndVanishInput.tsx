"use client"

import { AnimatePresence, motion } from "motion/react"
import { forwardRef, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

export interface PlaceholdersAndVanishInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "placeholder"
> {
  readonly placeholders: readonly string[]
  readonly placeholderClassName?: string
  readonly wrapperClassName?: string
}

function normalizeInputValue(value: string | number | readonly string[] | undefined): string {
  if (typeof value === "number") {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.join(", ")
  }

  if (typeof value === "string") {
    return value
  }

  return ""
}

export const PlaceholdersAndVanishInput = forwardRef<
  HTMLInputElement,
  PlaceholdersAndVanishInputProps
>(function PlaceholdersAndVanishInput(
  {
    className,
    defaultValue,
    onChange,
    placeholderClassName,
    placeholders,
    value,
    wrapperClassName,
    ...props
  },
  ref
) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0)
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    normalizeInputValue(defaultValue)
  )

  const resolvedPlaceholders = useMemo(() => {
    return placeholders.filter((entry) => entry.length > 0)
  }, [placeholders])
  const placeholderKey = resolvedPlaceholders.join("\u0000")
  const activePlaceholderIndex =
    resolvedPlaceholders.length === 0 ? 0 : currentPlaceholder % resolvedPlaceholders.length
  const resolvedValue = value === undefined ? uncontrolledValue : normalizeInputValue(value)
  const shouldShowPlaceholder = resolvedValue.length === 0

  useEffect(() => {
    if (resolvedPlaceholders.length <= 1) {
      return
    }

    let intervalId: number | null = null

    const stopAnimation = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const startAnimation = () => {
      if (document.visibilityState !== "visible" || intervalId !== null) {
        return
      }

      intervalId = window.setInterval(() => {
        setCurrentPlaceholder((currentIndex) => {
          return (currentIndex + 1) % resolvedPlaceholders.length
        })
      }, 3000)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startAnimation()
        return
      }

      stopAnimation()
    }

    startAnimation()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopAnimation()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [placeholderKey, resolvedPlaceholders.length])

  return (
    <div className={cn("relative min-w-0 flex-1", wrapperClassName)}>
      <input
        {...props}
        ref={ref}
        value={resolvedValue}
        onChange={(event) => {
          if (value === undefined) {
            setUncontrolledValue(event.target.value)
          }

          onChange?.(event)
        }}
        className={cn(
          "relative z-10 w-full appearance-none border-0 bg-transparent outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0",
          className
        )}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden">
        <AnimatePresence initial={false} mode="wait">
          {shouldShowPlaceholder && resolvedPlaceholders.length > 0 ? (
            <motion.p
              key={`${placeholderKey}-${activePlaceholderIndex}`}
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className={cn(
                "w-full truncate px-[var(--ow-space-1-5)] text-left [font-size:var(--ow-font-title)] font-medium leading-[var(--ow-line-control-md)] text-muted-foreground/55",
                placeholderClassName
              )}
            >
              {resolvedPlaceholders[activePlaceholderIndex]}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
})

PlaceholdersAndVanishInput.displayName = "PlaceholdersAndVanishInput"
