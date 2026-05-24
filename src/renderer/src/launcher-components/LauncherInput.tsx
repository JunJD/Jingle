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
  readonly expanded?: boolean
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
      expanded = false,
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
    const isExpandedMultiline = multiline && expanded

    return (
      <div
        className={cn(
          "launcher-input flex min-w-0 flex-1 items-center",
          isExpandedMultiline && "items-start",
          "gap-[var(--ow-gap-sm)]"
        )}
        data-status={status}
      >
        <PlaceholdersAndVanishInput
          ref={ref as React.Ref<LauncherInputElement>}
          aria-busy={status === "idle" ? undefined : true}
          multiline={multiline}
          className={cn(
            "min-w-0 border-0 bg-transparent px-[var(--ow-space-1)] py-0 [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control-sm)] shadow-none",
            multiline
              ? cn(
                  "resize-none overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] scrollbar-hide",
                  isExpandedMultiline
                    ? "min-h-[var(--launcher-ai-composer-expanded-input-min-h)] max-h-[var(--launcher-ai-composer-expanded-input-max-h)] py-[var(--ow-space-2-5)] leading-[var(--ow-line-chat)]"
                    : "min-h-[var(--ow-control-h-sm)] max-h-[40px] py-[3px] leading-[20px]"
                )
              : "h-[var(--ow-control-h-sm)]",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-transparent",
            className
          )}
          placeholderClassName={cn(
            multiline
              ? cn(
                  "[font-size:var(--ow-font-control)] font-medium text-muted-foreground/52",
                  isExpandedMultiline
                    ? "items-start pt-[var(--ow-space-2-5)] leading-[var(--ow-line-chat)]"
                    : "leading-[20px]"
                )
              : "[font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control-sm)] text-muted-foreground/52",
            "px-[var(--ow-space-1)]",
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
              "h-[var(--ow-icon-md)] w-[var(--ow-icon-md)]",
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
                  className="relative size-[var(--ow-icon-compact)] animate-spin"
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
