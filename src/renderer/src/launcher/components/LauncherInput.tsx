import { forwardRef, useRef } from "react"
import { Input, type InputProps } from "@/components/ui/input"
import type { LauncherPluginInputElement } from "../LauncherPluginHost"

export const LauncherInput = forwardRef<LauncherPluginInputElement, InputProps>(
  function LauncherInput(
    { className, onCompositionEnd, onCompositionStart, onKeyDown, ...props },
    ref
  ) {
    const isComposingRef = useRef(false)

    return (
      <Input
        ref={ref as React.Ref<HTMLInputElement>}
        className={[
          "h-8 border-0 bg-transparent px-1.5 py-0 text-[18px] font-medium leading-8 shadow-none",
          "focus-visible:ring-0 focus-visible:ring-offset-0",
          "placeholder:font-medium placeholder:text-muted-foreground/55",
          className
        ].join(" ")}
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

          onKeyDown?.(event)
        }}
        {...props}
      />
    )
  }
)
