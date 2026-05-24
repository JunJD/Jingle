"use client"

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import { ComposerArea, type ComposerAreaHandle } from "@/composer-area"
import type { ExtensionSourceMention } from "@shared/extension-sources"

interface PromptInputFocusTarget {
  focus: () => void
}

interface PromptInputContextValue {
  disabled: boolean
  isLoading: boolean
  maxHeight: number | string
  minHeight: number | string
  onSubmit?: () => void
  setFocusTarget: (target: PromptInputFocusTarget | null) => void
  setTextareaRef: (element: HTMLTextAreaElement | null) => void
  setValue: (value: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null)

function usePromptInput(): PromptInputContextValue {
  const context = useContext(PromptInputContext)

  if (!context) {
    throw new Error("PromptInput components must be used within PromptInput")
  }

  return context
}

export interface PromptInputProps extends React.ComponentProps<"div"> {
  disabled?: boolean
  isLoading?: boolean
  maxHeight?: number | string
  minHeight?: number | string
  onSubmit?: () => void
  onValueChange?: (value: string) => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  value?: string
}

export function PromptInput(props: PromptInputProps): React.JSX.Element {
  const {
    children,
    className,
    disabled = false,
    isLoading = false,
    maxHeight = 180,
    minHeight = 44,
    onClick,
    onSubmit,
    onValueChange,
    textareaRef,
    value,
    ...rest
  } = props
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const focusTargetRef = useRef<PromptInputFocusTarget | null>(null)
  const resolvedTextareaRef = textareaRef ?? internalTextareaRef
  const [internalValue, setInternalValue] = useState(value ?? "")
  const resolvedValue = value ?? internalValue
  const setFocusTarget = useCallback((target: PromptInputFocusTarget | null): void => {
    focusTargetRef.current = target
  }, [])
  const setTextareaRef = useCallback(
    (element: HTMLTextAreaElement | null): void => {
      resolvedTextareaRef.current = element
    },
    [resolvedTextareaRef]
  )
  const setValue = useCallback(
    (nextValue: string): void => {
      if (value === undefined) {
        setInternalValue(nextValue)
      }

      onValueChange?.(nextValue)
    },
    [onValueChange, value]
  )
  const contextValue = useMemo<PromptInputContextValue>(
    () => ({
      disabled,
      isLoading,
      maxHeight,
      minHeight,
      onSubmit,
      setFocusTarget,
      setTextareaRef,
      setValue,
      textareaRef: resolvedTextareaRef,
      value: resolvedValue
    }),
    [
      disabled,
      isLoading,
      maxHeight,
      minHeight,
      onSubmit,
      resolvedTextareaRef,
      resolvedValue,
      setFocusTarget,
      setTextareaRef,
      setValue
    ]
  )

  return (
    <TooltipProvider delayDuration={180}>
      <PromptInputContext.Provider value={contextValue}>
        <div
          className={cn(
            "ow-prompt-input flex min-w-0 cursor-text flex-col rounded-[var(--ow-prompt-input-radius)] border border-border/70 bg-background-elevated/90 shadow-[var(--ow-prompt-input-shadow)] transition-[border-color,box-shadow,background-color] duration-150",
            "focus-within:border-ring/36 focus-within:shadow-[var(--ow-prompt-input-shadow-focus)]",
            disabled && "cursor-not-allowed opacity-60",
            className
          )}
          onClick={(event) => {
            if (!disabled) {
              const focusTarget = focusTargetRef.current ?? resolvedTextareaRef.current
              focusTarget?.focus()
            }

            onClick?.(event)
          }}
          {...rest}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
  )
}

export interface PromptInputTextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> {
  composerRef?: React.RefObject<ComposerAreaHandle | null>
  disableAutosize?: boolean
  mode?: "textarea" | "composer"
  onValueChange?: (value: string) => void
  sourceMentions?: ExtensionSourceMention[]
  submitOnEnter?: boolean
}

function resolveCssSize(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value
}

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea(
    {
      className,
      composerRef,
      disableAutosize = false,
      mode = "textarea",
      onCompositionEnd,
      onCompositionStart,
      onKeyDown,
      onValueChange,
      placeholder,
      sourceMentions,
      submitOnEnter = true,
      ...props
    },
    ref
  ) {
    const {
      disabled,
      maxHeight,
      minHeight,
      onSubmit,
      setFocusTarget,
      setTextareaRef,
      setValue,
      textareaRef,
      value
    } = usePromptInput()
    const composingRef = useRef(false)

    const updateTextareaRef = useCallback(
      (element: HTMLTextAreaElement | null): void => {
        setTextareaRef(element)
        setFocusTarget(element)

        if (typeof ref === "function") {
          ref(element)
          return
        }

        if (ref) {
          ref.current = element
        }
      },
      [ref, setFocusTarget, setTextareaRef]
    )
    const updateComposerRef = useCallback(
      (handle: ComposerAreaHandle | null): void => {
        setFocusTarget(handle)

        if (composerRef) {
          composerRef.current = handle
        }
      },
      [composerRef, setFocusTarget]
    )
    const adjustHeight = useCallback(
      (element: HTMLTextAreaElement | null): void => {
        if (!element || disableAutosize) {
          return
        }

        element.style.height = "auto"
        element.style.minHeight = resolveCssSize(minHeight)
        element.style.maxHeight = resolveCssSize(maxHeight)
        element.style.height = `${element.scrollHeight}px`
      },
      [disableAutosize, maxHeight, minHeight]
    )

    useLayoutEffect(() => {
      adjustHeight(textareaRef.current)
    }, [adjustHeight, textareaRef, value])

    if (mode === "composer") {
      return (
        <ComposerArea
          ref={updateComposerRef}
          className={cn(
            "min-w-0 resize-none border-0 bg-transparent px-0 py-0 text-foreground outline-none placeholder:text-muted-foreground/58 focus:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-100",
            "scrollbar-hide whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
            className
          )}
          disabled={disabled}
          maxHeight={maxHeight}
          minHeight={minHeight}
          onKeyDown={(event) => {
            const keyboardEvent = event as unknown as KeyboardEvent & {
              nativeEvent?: KeyboardEvent
            }

            if (!("nativeEvent" in keyboardEvent)) {
              keyboardEvent.nativeEvent = keyboardEvent
            }

            onKeyDown?.(keyboardEvent as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
          }}
          onSubmit={onSubmit}
          onValueChange={(nextValue) => {
            setValue(nextValue)
            onValueChange?.(nextValue)
          }}
          placeholder={placeholder}
          sourceMentions={sourceMentions}
          submitOnEnter={submitOnEnter}
          value={value}
        />
      )
    }

    return (
      <textarea
        ref={(element) => {
          updateTextareaRef(element)
          adjustHeight(element)
        }}
        className={cn(
          "min-w-0 resize-none border-0 bg-transparent px-0 py-0 text-foreground outline-none placeholder:text-muted-foreground/58 focus:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-100",
          "scrollbar-hide whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
          className
        )}
        disabled={disabled}
        onChange={(event) => {
          adjustHeight(event.target)
          setValue(event.target.value)
          onValueChange?.(event.target.value)
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false
          onCompositionEnd?.(event)
        }}
        onCompositionStart={(event) => {
          composingRef.current = true
          onCompositionStart?.(event)
        }}
        onKeyDown={(event) => {
          const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }

          if (event.key === "Enter" && submitOnEnter) {
            if (
              event.shiftKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              composingRef.current ||
              nativeEvent.isComposing === true ||
              nativeEvent.keyCode === 229
            ) {
              onKeyDown?.(event)
              return
            }

            event.preventDefault()
            onSubmit?.()
            return
          }

          onKeyDown?.(event)
        }}
        placeholder={placeholder}
        rows={1}
        value={value}
        {...props}
      />
    )
  }
)

export type PromptInputActionsProps = React.ComponentProps<"div">

export function PromptInputActions(props: PromptInputActionsProps): React.JSX.Element {
  const { className, ...rest } = props

  return (
    <div className={cn("flex min-w-0 items-center gap-[var(--ow-gap-sm)]", className)} {...rest} />
  )
}

export interface PromptInputActionProps extends React.ComponentProps<"button"> {
  icon: ReactNode
  label: string
  tooltip?: ReactNode
  tooltipSide?: "top" | "right" | "bottom" | "left"
}

export function PromptInputAction(props: PromptInputActionProps): React.JSX.Element {
  const {
    className,
    icon,
    label,
    title,
    tooltip,
    tooltipSide = "top",
    type = "button",
    ...rest
  } = props
  const button = (
    <button
      aria-label={label}
      className={cn(
        "inline-flex size-[var(--ow-prompt-input-action-size)] shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-muted-foreground transition hover:bg-background-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-45",
        className
      )}
      title={title ?? label}
      type={type}
      {...rest}
    >
      {icon}
    </button>
  )

  if (!tooltip) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side={tooltipSide}
        className="rounded-[var(--ow-radius-sm)] bg-popover px-[var(--ow-space-2)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] text-popover-foreground shadow-md"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
