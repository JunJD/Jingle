import { useRef, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"
import type { LauncherShellConfig } from "@shared/launcher"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import { useLauncherChromeAudit } from "@launcher-shell/hooks/useLauncherChromeAudit"
import { LauncherInput } from "./LauncherInput"

interface LauncherChromeProps {
  children?: ReactNode
  footer?: ReactNode
  headerLeading?: ReactNode
  headerTrailing?: ReactNode
  inputClassName?: string
  inputRef: RefObject<LauncherInputElement | null>
  inputStatus?: LauncherInputStatus
  inputValue: string
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
  placeholders: readonly string[]
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
    inputStatus = "idle",
    inputValue,
    onInputKeyDown,
    onInputValueChange,
    placeholders,
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
    <div
      className="launcher-chrome flex h-full w-full flex-col"
      data-input-status={inputStatus}
      data-surface={surface}
    >
      <div
        ref={headerRef}
        className="launcher-chrome-header flex shrink-0 items-center gap-3 px-6"
        style={{
          borderBottom: showHeaderDivider ? "1px solid var(--launcher-border)" : "none",
          height: shellConfig.headerHeight
        }}
      >
        {headerLeading ? <div className="flex shrink-0 items-center">{headerLeading}</div> : null}

        <LauncherInput
          ref={inputRef}
          status={inputStatus}
          value={inputValue}
          onChange={(event) => onInputValueChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholders={placeholders}
          className={cn(
            "flex-1 text-[20px] font-semibold tracking-[-0.03em] text-foreground",
            inputClassName
          )}
          placeholderClassName="text-[20px] font-semibold tracking-[-0.03em] text-muted-foreground/75"
        />

        {headerTrailing ? (
          <div className="flex shrink-0 items-center gap-4">{headerTrailing}</div>
        ) : null}
      </div>

      {children}

      {footer ? (
        <div
          ref={footerRef}
          className="launcher-chrome-footer flex shrink-0 items-center justify-between px-6"
          style={{
            borderTop: "1px solid var(--launcher-border)",
            backgroundColor: "var(--launcher-footer-strip)",
            height: shellConfig.footerHeight
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
