import { Loader2 } from "lucide-react"
import { useRef, type ReactNode, type Ref } from "react"
import {
  PlaceholdersAndVanishInput,
  type PlaceholdersAndVanishInputProps
} from "@/components/ui/PlaceholdersAndVanishInput"
import { cn } from "@/lib/utils"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"

export interface LauncherInputProps extends PlaceholdersAndVanishInputProps {
  readonly expanded?: boolean
  readonly multiline?: boolean
  readonly ref?: Ref<LauncherInputElement>
  readonly status?: LauncherInputStatus
  readonly trailing?: ReactNode
  readonly showStatusIndicator?: boolean
}

function shouldPreserveNativeInputNavigation(
  event: React.KeyboardEvent<LauncherInputElement>
): boolean {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    return true
  }

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    return event.metaKey || event.ctrlKey || event.altKey
  }

  return false
}

function getLauncherInputHeightClassName(input: {
  isExpandedMultiline: boolean
  multiline: boolean
}): string {
  if (!input.multiline) {
    return "h-[var(--jingle-control-h-sm)]"
  }

  if (input.isExpandedMultiline) {
    return "min-h-[var(--launcher-ai-composer-expanded-input-min-h)] max-h-[var(--launcher-ai-composer-expanded-input-max-h)] py-[var(--jingle-space-2-5)] leading-[var(--jingle-line-chat)]"
  }

  return "min-h-[var(--jingle-control-h-sm)] max-h-[40px] py-[3px] leading-[20px]"
}

function getLauncherInputPlaceholderClassName(input: {
  isExpandedMultiline: boolean
  multiline: boolean
}): string {
  if (!input.multiline) {
    return "[font-size:var(--jingle-font-control)] font-medium leading-[var(--jingle-line-control-sm)] text-muted-foreground/52"
  }

  return cn(
    "[font-size:var(--jingle-font-control)] font-medium text-muted-foreground/52",
    input.isExpandedMultiline
      ? "items-start pt-[var(--jingle-space-2-5)] leading-[var(--jingle-line-chat)]"
      : "leading-[20px]"
  )
}

function LauncherInputStatusIndicator(props: {
  showStatusIndicator: boolean
  status: LauncherInputStatus
  trailing: ReactNode
}): React.JSX.Element | ReactNode {
  const { showStatusIndicator, status, trailing } = props

  if (trailing) {
    return trailing
  }

  if (!showStatusIndicator || status === "idle") {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full border backdrop-blur-sm transition",
        "h-[var(--jingle-icon-md)] w-[var(--jingle-icon-md)]",
        status === "pending" && "border-status-warning/25 bg-status-warning/10 text-status-warning",
        status === "tooling" &&
          "border-status-info/40 bg-status-info/16 text-status-info shadow-[0_0_18px_color-mix(in_srgb,var(--status-info)_34%,transparent)]"
      )}
    >
      {status === "tooling" ? (
        <>
          <span className="absolute inset-[-3px] rounded-full border border-status-info/35" />
          <span className="absolute inset-0 rounded-full bg-status-info/18 animate-ping" />
          <Loader2
            className="relative size-[var(--jingle-icon-compact)] animate-spin"
            strokeWidth={2.25}
          />
        </>
      ) : (
        <span className="animate-tactical-pulse h-[var(--jingle-status-dot-size)] w-[var(--jingle-status-dot-size)] rounded-full bg-current" />
      )}
    </div>
  )
}

export function LauncherInput(props: LauncherInputProps): React.JSX.Element {
  const {
    className,
    expanded = false,
    multiline = false,
    onCompositionEnd,
    onCompositionStart,
    onKeyDown,
    placeholderClassName,
    ref,
    showStatusIndicator = true,
    status = "idle",
    trailing,
    ...inputProps
  } = props
  const isComposingRef = useRef(false)
  const isExpandedMultiline = multiline && expanded

  return (
    <div
      className={cn(
        "launcher-input flex min-w-0 flex-1 items-center",
        isExpandedMultiline && "items-start",
        "gap-[var(--jingle-gap-sm)]"
      )}
      data-status={status}
    >
      <PlaceholdersAndVanishInput
        ref={ref as React.Ref<LauncherInputElement>}
        aria-busy={status === "idle" ? undefined : true}
        multiline={multiline}
        className={cn(
          "min-w-0 border-0 bg-transparent px-[var(--launcher-input-content-inset-x)] py-0 [font-size:var(--jingle-font-control)] font-medium leading-[var(--jingle-line-control-sm)] shadow-none",
          multiline &&
            "resize-none overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] scrollbar-hide",
          getLauncherInputHeightClassName({ isExpandedMultiline, multiline }),
          "focus-visible:ring-0 focus-visible:ring-offset-0",
          "placeholder:text-transparent",
          className
        )}
        placeholderClassName={cn(
          getLauncherInputPlaceholderClassName({ isExpandedMultiline, multiline }),
          "px-[var(--launcher-input-content-inset-x)]",
          placeholderClassName
        )}
        data-status={status}
        onCompositionStart={(event) => {
          isComposingRef.current = true
          onCompositionStart?.(event)
        }}
        onCompositionEnd={(event) => {
          isComposingRef.current = false
          onCompositionEnd?.(event)
        }}
        onKeyDown={(event) => {
          const nativeEvent = event.nativeEvent as KeyboardEvent & {
            isComposing?: boolean
          }

          if (
            isComposingRef.current ||
            nativeEvent.isComposing === true ||
            nativeEvent.keyCode === 229
          ) {
            return
          }

          if (shouldPreserveNativeInputNavigation(event)) {
            return
          }

          onKeyDown?.(event)
        }}
        {...inputProps}
      />

      <LauncherInputStatusIndicator
        showStatusIndicator={showStatusIndicator}
        status={status}
        trailing={trailing}
      />
    </div>
  )
}
