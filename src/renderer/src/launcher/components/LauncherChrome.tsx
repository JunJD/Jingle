import { useRef, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import { useLauncherChromeAudit } from "../hooks/useLauncherChromeAudit"
import { LauncherInput } from "./LauncherInput"

interface LauncherChromeProps {
  children?: ReactNode
  footer?: ReactNode
  headerLeading?: ReactNode
  headerTrailing?: ReactNode
  inputClassName?: string
  inputRef: RefObject<HTMLInputElement | null>
  inputValue: string
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
  placeholder: string
  shellConfig: LauncherShellConfig
  showHeaderDivider?: boolean
  surface: string
}

export function LauncherChrome(props: LauncherChromeProps): React.JSX.Element {
  const {
    children,
    footer,
    headerLeading,
    headerTrailing,
    inputClassName,
    inputRef,
    inputValue,
    onInputKeyDown,
    onInputValueChange,
    placeholder,
    shellConfig,
    showHeaderDivider = true,
    surface
  } = props
  const headerRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  useLauncherChromeAudit({
    footerRef,
    hasFooter: footer !== undefined,
    headerRef,
    shellConfig,
    surface
  })

  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={headerRef}
        className="flex shrink-0 items-center gap-5 px-6"
        style={{
          borderBottom: showHeaderDivider ? "1px solid var(--launcher-border)" : "none",
          height: shellConfig.headerHeight
        }}
      >
        {headerLeading ? <div className="flex shrink-0 items-center">{headerLeading}</div> : null}

        <LauncherInput
          ref={inputRef}
          value={inputValue}
          onChange={(event) => onInputValueChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className={cn(
            "flex-1 text-[20px] font-semibold tracking-[-0.03em] text-foreground placeholder:text-muted-foreground/75",
            inputClassName
          )}
        />

        {headerTrailing ? (
          <div className="flex shrink-0 items-center gap-4">{headerTrailing}</div>
        ) : null}
      </div>

      {children}

      {footer ? (
        <div
          ref={footerRef}
          className="flex shrink-0 items-center justify-between px-6"
          style={{
            borderTop: "1px solid var(--launcher-border)",
            backgroundColor: "color-mix(in srgb, var(--launcher-surface-strong) 24%, transparent)",
            height: shellConfig.footerHeight
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
