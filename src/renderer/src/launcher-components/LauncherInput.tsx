import { Loader2 } from "lucide-react"
import { forwardRef, useRef, type ReactNode } from "react"
import {
  PlaceholdersAndVanishInput,
  type PlaceholdersAndVanishInputProps
} from "@/components/ui/PlaceholdersAndVanishInput"
import { cn } from "@/lib/utils"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"

export interface LauncherInputProps extends PlaceholdersAndVanishInputProps {
  readonly density?: "default" | "compact"
  readonly multiline?: boolean
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

export const LauncherInput = forwardRef<LauncherInputElement, LauncherInputProps>(
  function LauncherInput(
    {
      className,
      density = "default",
      multiline = false,
      onCompositionEnd,
      onCompositionStart,
      onKeyDown,
      placeholderClassName,
      showStatusIndicator = true,
      status = "idle",
      trailing,
      ...props
    },
    ref
  ) {
    const isComposingRef = useRef(false)
    const isCompact = density === "compact"

    return (
      <div
        className={cn(
          "launcher-input flex min-w-0 flex-1 items-center",
          isCompact ? "gap-[var(--ow-gap-sm)]" : "gap-[var(--ow-space-2-5)]"
        )}
        data-status={status}
      >
        <PlaceholdersAndVanishInput
          ref={ref as React.Ref<LauncherInputElement>}
          aria-busy={status === "idle" ? undefined : true}
          multiline={multiline}
          className={cn(
            isCompact
              ? "min-w-0 border-0 bg-transparent px-[var(--ow-space-1)] py-0 [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control-sm)] shadow-none"
              : "min-w-0 border-0 bg-transparent px-[var(--ow-space-1-5)] py-0 [font-size:var(--ow-font-title)] font-medium leading-[var(--ow-line-control-md)] shadow-none",
            multiline
              ? "max-h-[40px] resize-none overflow-y-auto whitespace-pre-wrap break-words leading-[20px] [overflow-wrap:anywhere] scrollbar-hide"
              : isCompact
                ? "h-[var(--ow-control-h-sm)]"
                : "h-[var(--ow-control-h-md)]",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-transparent",
            className
          )}
          placeholderClassName={cn(
            isCompact
              ? "[font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control-sm)] text-muted-foreground/52"
              : "[font-size:var(--ow-font-title)] font-medium leading-[var(--ow-line-control-md)] text-muted-foreground/55",
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
          {...props}
        />

        {trailing ? (
          trailing
        ) : !showStatusIndicator || status === "idle" ? null : (
          <div
            aria-hidden="true"
            className={cn(
              "relative flex shrink-0 items-center justify-center rounded-full border backdrop-blur-sm transition",
              isCompact
                ? "h-[var(--ow-icon-md)] w-[var(--ow-icon-md)]"
                : "h-[var(--ow-icon-lg)] w-[var(--ow-icon-lg)]",
              status === "pending" &&
                "border-status-warning/25 bg-status-warning/10 text-status-warning",
              status === "tooling" &&
                "border-status-info/40 bg-status-info/16 text-status-info shadow-[0_0_18px_color-mix(in_srgb,var(--status-info)_34%,transparent)]"
            )}
          >
            {status === "tooling" ? (
              <>
                <span className="absolute inset-[-3px] rounded-full border border-status-info/35" />
                <span className="absolute inset-0 rounded-full bg-status-info/18 animate-ping" />
                <Loader2
                  className={cn(
                    "relative animate-spin",
                    isCompact ? "size-[var(--ow-icon-compact)]" : "size-[var(--ow-icon-sm)]"
                  )}
                  strokeWidth={2.25}
                />
              </>
            ) : (
              <span className="animate-tactical-pulse h-[var(--ow-status-dot-size)] w-[var(--ow-status-dot-size)] rounded-full bg-current" />
            )}
          </div>
        )}
      </div>
    )
  }
)
