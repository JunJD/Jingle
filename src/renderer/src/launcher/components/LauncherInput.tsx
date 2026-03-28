import { Loader2 } from "lucide-react"
import { forwardRef, useRef } from "react"
import { Input, type InputProps } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { LauncherInputStatus } from "../launcher-input-status"
import type { LauncherPluginInputElement } from "../LauncherPluginHost"

export interface LauncherInputProps extends InputProps {
  readonly status?: LauncherInputStatus
}

function shouldPreserveNativeInputNavigation(
  event: React.KeyboardEvent<HTMLInputElement>
): boolean {
  const isArrowKey =
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight" ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown"

  if (!isArrowKey) {
    return false
  }

  return event.metaKey || event.ctrlKey || event.altKey
}

export const LauncherInput = forwardRef<LauncherPluginInputElement, LauncherInputProps>(
  function LauncherInput(
    { className, onCompositionEnd, onCompositionStart, onKeyDown, status = "idle", ...props },
    ref
  ) {
    const isComposingRef = useRef(false)

    return (
      <div className="launcher-input flex min-w-0 flex-1 items-center gap-2.5" data-status={status}>
        <Input
          ref={ref as React.Ref<HTMLInputElement>}
          aria-busy={status === "idle" ? undefined : true}
          className={cn(
            "h-8 min-w-0 border-0 bg-transparent px-1.5 py-0 text-[18px] font-medium leading-8 shadow-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:font-medium placeholder:text-muted-foreground/55",
            className
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

        {status === "idle" ? null : (
          <div
            aria-hidden="true"
            className={cn(
              "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border backdrop-blur-sm transition",
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
                <Loader2 className="relative size-3.5 animate-spin" strokeWidth={2.25} />
              </>
            ) : (
              <span className="animate-tactical-pulse h-1.5 w-1.5 rounded-full bg-current" />
            )}
          </div>
        )}
      </div>
    )
  }
)
