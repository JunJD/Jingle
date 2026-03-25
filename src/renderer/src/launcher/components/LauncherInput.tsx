import { forwardRef, useRef } from "react"
import { Input, type InputProps } from "@/components/ui/input"

export const LauncherInput = forwardRef<HTMLInputElement, InputProps>(function LauncherInput(
  { className, onCompositionEnd, onCompositionStart, onKeyDown, ...props },
  ref
) {
  const isComposingRef = useRef(false)

  return (
    <Input
      ref={ref}
      className={[
        "h-auto border-0 bg-transparent px-0 py-0 text-[18px] font-medium leading-none shadow-none",
        "focus-visible:ring-0 focus-visible:ring-offset-0",
        "placeholder:text-muted-foreground",
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
})
