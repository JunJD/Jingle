"use client"

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref
} from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  ComposerArea,
  type ComposerAreaHandle,
  type ComposerWorkspaceFileMention
} from "@/composer-area"
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
  const context = use(PromptInputContext)

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
    onPointerDown,
    onSubmit,
    onValueChange,
    textareaRef,
    value,
    ...rest
  } = props
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const focusTargetRef = useRef<PromptInputFocusTarget | null>(null)
  const [internalValue, setInternalValue] = useState(value ?? "")
  const resolvedValue = value ?? internalValue
  useImperativeHandle<HTMLTextAreaElement | null, HTMLTextAreaElement | null>(
    textareaRef ?? null,
    () => internalTextareaRef.current
  )
  const setFocusTarget = useCallback((target: PromptInputFocusTarget | null): void => {
    focusTargetRef.current = target
  }, [])
  const setTextareaRef = useCallback((element: HTMLTextAreaElement | null): void => {
    internalTextareaRef.current = element
  }, [])
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
      textareaRef: internalTextareaRef,
      value: resolvedValue
    }),
    [
      disabled,
      isLoading,
      maxHeight,
      minHeight,
      onSubmit,
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
            "jingle-prompt-input flex min-w-0 cursor-text flex-col rounded-[var(--jingle-prompt-input-radius)] border border-border/70 bg-background-elevated/90 shadow-[var(--jingle-prompt-input-shadow)] transition-[border-color,box-shadow,background-color] duration-150",
            "focus-within:border-ring/36 focus-within:shadow-[var(--jingle-prompt-input-shadow-focus)]",
            disabled && "cursor-not-allowed opacity-60",
            className
          )}
          onPointerDown={(event) => {
            if (!disabled) {
              const focusTarget = focusTargetRef.current ?? internalTextareaRef.current
              focusTarget?.focus()
            }

            onPointerDown?.(event)
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
  onMentionQueryChange?: (query: string | null) => void
  onVisualLineOverflowChange?: (isOverflowing: boolean) => void
  onValueChange?: (value: string) => void
  ref?: Ref<HTMLTextAreaElement>
  sourceMentions?: ExtensionSourceMention[]
  workspaceFileMentions?: ComposerWorkspaceFileMention[]
  workspaceFileSearchEnabled?: boolean
  workspaceFileSearchIncomplete?: boolean
  workspaceFileSearchInProgress?: boolean
}

function resolveCssSize(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value
}

function parseCssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isElementOverTwoVisualLines(element: HTMLElement): boolean {
  const styles = window.getComputedStyle(element)
  const lineHeight = Number.parseFloat(styles.lineHeight)
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return false
  }

  const contentHeight = Math.max(
    0,
    element.scrollHeight -
      parseCssPixelValue(styles.paddingTop) -
      parseCssPixelValue(styles.paddingBottom)
  )
  return contentHeight > lineHeight * 2 + 1
}

export function PromptInputTextarea(props: PromptInputTextareaProps): React.JSX.Element {
  const {
    className,
    composerRef,
    disableAutosize = false,
    mode = "textarea",
    onCompositionEnd,
    onCompositionStart,
    onKeyDown,
    onMentionQueryChange,
    onVisualLineOverflowChange,
    onValueChange,
    placeholder,
    ref,
    sourceMentions,
    workspaceFileMentions,
    workspaceFileSearchEnabled,
    workspaceFileSearchIncomplete,
    workspaceFileSearchInProgress,
    ...textareaProps
  } = props
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
    const composerRootRef = useRef<HTMLElement | null>(null)
    const lastVisualLineOverflowRef = useRef<boolean | null>(null)
    const visualLineReportFrameRef = useRef<number | null>(null)

    const reportVisualLineOverflow = useCallback(
      (element: HTMLElement | null): void => {
        if (!element || !onVisualLineOverflowChange) {
          return
        }

        const isOverflowing = isElementOverTwoVisualLines(element)
        if (lastVisualLineOverflowRef.current === isOverflowing) {
          return
        }

        lastVisualLineOverflowRef.current = isOverflowing
        onVisualLineOverflowChange(isOverflowing)
      },
      [onVisualLineOverflowChange]
    )
    const scheduleVisualLineOverflowReport = useCallback(
      (element: HTMLElement | null): void => {
        if (!element || !onVisualLineOverflowChange) {
          return
        }

        if (visualLineReportFrameRef.current !== null) {
          window.cancelAnimationFrame(visualLineReportFrameRef.current)
        }

        visualLineReportFrameRef.current = window.requestAnimationFrame(() => {
          visualLineReportFrameRef.current = null
          reportVisualLineOverflow(element)
        })
      },
      [onVisualLineOverflowChange, reportVisualLineOverflow]
    )

    const updateTextareaRef = useCallback(
      (element: HTMLTextAreaElement | null): void => {
        setTextareaRef(element)
        setFocusTarget(element)
        scheduleVisualLineOverflowReport(element)

        if (typeof ref === "function") {
          ref(element)
          return
        }

        if (ref) {
          ref.current = element
        }
      },
      [ref, scheduleVisualLineOverflowReport, setFocusTarget, setTextareaRef]
    )
    const updateComposerRef = useCallback(
      (handle: ComposerAreaHandle | null): void => {
        setFocusTarget(handle)
        const element = handle?.getElement() ?? null
        composerRootRef.current = element
        scheduleVisualLineOverflowReport(element)

        if (composerRef) {
          composerRef.current = handle
        }
      },
      [composerRef, scheduleVisualLineOverflowReport, setFocusTarget]
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

    useEffect(() => {
      const visualLineReportFrame = visualLineReportFrameRef

      return () => {
        if (visualLineReportFrame.current !== null) {
          window.cancelAnimationFrame(visualLineReportFrame.current)
        }
      }
    }, [])

    useLayoutEffect(() => {
      const element = mode === "composer" ? composerRootRef.current : textareaRef.current
      if (!element || !onVisualLineOverflowChange || typeof ResizeObserver === "undefined") {
        return
      }

      const observer = new ResizeObserver(() => {
        reportVisualLineOverflow(element)
      })
      observer.observe(element)
      scheduleVisualLineOverflowReport(element)

      return () => observer.disconnect()
    }, [
      mode,
      onVisualLineOverflowChange,
      reportVisualLineOverflow,
      scheduleVisualLineOverflowReport,
      textareaRef
    ])

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
          onMentionQueryChange={onMentionQueryChange}
          onValueChange={(nextValue) => {
            setValue(nextValue)
            onValueChange?.(nextValue)
            scheduleVisualLineOverflowReport(composerRootRef.current)
          }}
          placeholder={placeholder}
          sourceMentions={sourceMentions}
          value={value}
          workspaceFileMentions={workspaceFileMentions}
          workspaceFileSearchEnabled={workspaceFileSearchEnabled}
          workspaceFileSearchIncomplete={workspaceFileSearchIncomplete}
          workspaceFileSearchInProgress={workspaceFileSearchInProgress}
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
          scheduleVisualLineOverflowReport(event.target)
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

          if (event.key === "Enter") {
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
        {...textareaProps}
      />
    )
}

export type PromptInputActionsProps = React.ComponentProps<"div">

export function PromptInputActions(props: PromptInputActionsProps): React.JSX.Element {
  const { className, ...rest } = props

  return (
    <div className={cn("flex min-w-0 items-center gap-[var(--jingle-gap-sm)]", className)} {...rest} />
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
        "inline-flex size-[var(--jingle-prompt-input-action-size)] shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-muted-foreground transition hover:bg-background-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-45",
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
        className="rounded-[var(--jingle-radius-sm)] bg-popover px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] text-popover-foreground shadow-md"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
