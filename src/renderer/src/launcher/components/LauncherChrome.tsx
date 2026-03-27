import { useRef, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import { useLauncherChromeAudit } from "../hooks/useLauncherChromeAudit"
import { LauncherInput } from "./LauncherInput"
import type { LauncherPluginInputElement } from "../LauncherPluginHost"

interface LauncherChromeProps {
  children?: ReactNode
  footer?: ReactNode
  headerLeading?: ReactNode
  headerTrailing?: ReactNode
  inputClassName?: string
  inputRef: RefObject<LauncherPluginInputElement | null>
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
    <div className="launcher-chrome flex h-full w-full flex-col" data-surface={surface}>
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
