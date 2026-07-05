"use client"

import { AnimatePresence } from "motion/react"
import { p as MotionParagraph } from "motion/react-m"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react"
import { cn } from "@/lib/utils"

type PlaceholderInputElement = HTMLInputElement | HTMLTextAreaElement

export interface PlaceholdersAndVanishInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  | "defaultValue"
  | "onChange"
  | "onCompositionEnd"
  | "onCompositionStart"
  | "onKeyDown"
  | "placeholder"
  | "value"
> {
  readonly defaultValue?: string | number | readonly string[]
  readonly multiline?: boolean
  readonly onChange?: React.ChangeEventHandler<PlaceholderInputElement>
  readonly onCompositionEnd?: React.CompositionEventHandler<PlaceholderInputElement>
  readonly onCompositionStart?: React.CompositionEventHandler<PlaceholderInputElement>
  readonly onKeyDown?: React.KeyboardEventHandler<PlaceholderInputElement>
  readonly placeholders: readonly string[]
  readonly placeholderClassName?: string
  readonly ref?: Ref<PlaceholderInputElement>
  readonly value?: string | number | readonly string[]
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

function getActivePlaceholderIndex(placeholderCount: number, currentPlaceholder: number): number {
  if (placeholderCount === 0) {
    return 0
  }

  return currentPlaceholder % placeholderCount
}

function resolveInputValue(
  controlledValue: string | number | readonly string[] | undefined,
  uncontrolledValue: string
): string {
  if (controlledValue === undefined) {
    return uncontrolledValue
  }

  return normalizeInputValue(controlledValue)
}

function getTextareaHeight(scrollHeight: number, maxHeight: number): number {
  if (!Number.isFinite(maxHeight)) {
    return scrollHeight
  }

  return Math.min(scrollHeight, maxHeight)
}

export function PlaceholdersAndVanishInput(
  props: PlaceholdersAndVanishInputProps
): React.JSX.Element {
  const {
    className,
    defaultValue,
    multiline = false,
    onChange,
    placeholderClassName,
    placeholders,
    ref,
    value,
    wrapperClassName,
    ...inputProps
  } = props
  const inputElementRef = useRef<PlaceholderInputElement | null>(null)
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0)
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    normalizeInputValue(defaultValue)
  )

  const resolvedPlaceholders = useMemo(() => {
    return placeholders.filter((entry) => entry.length > 0)
  }, [placeholders])
  const placeholderKey = resolvedPlaceholders.join("\u0000")
  const activePlaceholderIndex = getActivePlaceholderIndex(
    resolvedPlaceholders.length,
    currentPlaceholder
  )
  const resolvedValue = resolveInputValue(value, uncontrolledValue)
  const shouldShowPlaceholder = resolvedValue.length === 0
  const controlClassName = cn(
    "relative z-10 block w-full appearance-none border-0 bg-transparent outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0",
    className
  )
  const setInputRef = useCallback(
    (element: PlaceholderInputElement | null): void => {
      inputElementRef.current = element
      if (typeof ref === "function") {
        ref(element)
        return
      }

      if (ref) {
        ref.current = element
      }
    },
    [ref]
  )

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

  useLayoutEffect(() => {
    const element = inputElementRef.current
    if (!multiline || !(element instanceof HTMLTextAreaElement)) {
      return
    }

    element.style.height = "auto"
    const maxHeight = Number.parseFloat(window.getComputedStyle(element).maxHeight)
    const nextHeight = getTextareaHeight(element.scrollHeight, maxHeight)
    element.style.height = `${Math.ceil(nextHeight)}px`
  }, [multiline, resolvedValue])

  return (
    <div className={cn("relative min-w-0 flex-1", wrapperClassName)}>
      {multiline ? (
        <textarea
          {...(inputProps as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          ref={setInputRef as React.Ref<HTMLTextAreaElement>}
          rows={1}
          value={resolvedValue}
          onChange={(event) => {
            if (value === undefined) {
              setUncontrolledValue(event.target.value)
            }

            onChange?.(event)
          }}
          className={controlClassName}
        />
      ) : (
        <input
          {...inputProps}
          ref={setInputRef as React.Ref<HTMLInputElement>}
          value={resolvedValue}
          onChange={(event) => {
            if (value === undefined) {
              setUncontrolledValue(event.target.value)
            }

            onChange?.(event)
          }}
          className={controlClassName}
        />
      )}

      <div className={cn("pointer-events-none absolute inset-0 flex items-center overflow-hidden")}>
        <AnimatePresence initial={false} mode="wait">
          {shouldShowPlaceholder && resolvedPlaceholders.length > 0 ? (
            <MotionParagraph
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
            </MotionParagraph>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
