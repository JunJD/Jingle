import type { ReactNode } from "react"
import type { HITLDisplaySize } from "@shared/hitl"
import { cn } from "@/lib/utils"

export function ComposerInterruptShell(props: {
  actions: ReactNode
  body?: ReactNode
  className?: string
  density?: "default" | "compact"
  header: ReactNode
  size?: HITLDisplaySize
}): React.JSX.Element {
  const { actions, body, className, density = "default", header, size = "small" } = props
  const isLarge = size === "large"

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--jingle-radius-lg)] border border-border/65 bg-background-elevated/86 shadow-[0_8px_22px_rgba(32,38,45,0.07)] backdrop-blur-xl",
        density === "compact" && "rounded-[var(--jingle-radius-md)]",
        className
      )}
      data-interrupt-size={size}
    >
      <div
        className={cn(
          "grid",
          isLarge ? "gap-[var(--jingle-space-2)]" : "gap-[var(--jingle-space-1-5)]",
          density === "compact"
            ? "px-[var(--jingle-space-3)] py-[var(--jingle-space-2)]"
            : "px-[var(--jingle-space-4)] py-[var(--jingle-space-3)]"
        )}
      >
        {header}
        {body ? (
          <div
            className={cn(
              "min-w-0 overflow-y-auto pr-[var(--jingle-space-1)]",
              isLarge
                ? density === "compact"
                  ? "max-h-[min(18vh,132px)]"
                  : "max-h-[min(32vh,280px)]"
                : "max-h-[96px]"
            )}
          >
            {body}
          </div>
        ) : null}
        {actions}
      </div>
    </div>
  )
}
