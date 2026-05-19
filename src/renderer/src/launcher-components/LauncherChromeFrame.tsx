import { useRef, type ReactNode } from "react"
import type { LauncherShellConfig } from "@shared/launcher"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import { useLauncherChromeAudit } from "@launcher-shell/hooks/useLauncherChromeAudit"

interface LauncherChromeFrameProps {
  children?: ReactNode
  density?: "default" | "compact"
  footer?: ReactNode
  footerVariant?: "strip" | "composer"
  headerLeading?: ReactNode
  headerMain?: ReactNode
  headerTrailing?: ReactNode
  inputAccessory?: ReactNode
  inputStatus?: LauncherInputStatus
  shellConfig: LauncherShellConfig
  showHeaderDivider?: boolean
  surface: string
}

export function LauncherChromeFrame(props: LauncherChromeFrameProps): React.JSX.Element {
  const {
    children,
    density = "default",
    footer,
    footerVariant = "strip",
    headerLeading,
    headerMain,
    headerTrailing,
    inputAccessory,
    inputStatus,
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
        className={`launcher-chrome-header flex shrink-0 items-center ${
          density === "compact"
            ? "gap-[var(--ow-gap-sm)] px-[var(--launcher-chrome-x-compact)]"
            : "gap-[var(--ow-space-2-5)] px-[var(--launcher-chrome-x)]"
        }`}
        style={{
          borderBottom: showHeaderDivider ? "1px solid var(--launcher-border)" : "none",
          height: shellConfig.headerHeight
        }}
      >
        {headerLeading ? <div className="flex shrink-0 items-center">{headerLeading}</div> : null}

        <div className="min-w-0 flex-1">{headerMain}</div>

        {headerTrailing ? (
          <div
            className={`flex shrink-0 items-center ${
              density === "compact" ? "gap-[var(--ow-gap-sm)]" : "gap-[var(--ow-space-2-5)]"
            }`}
          >
            {headerTrailing}
          </div>
        ) : null}
      </div>

      {inputAccessory}

      {children}

      {footer ? (
        <div
          ref={footerRef}
          className={`launcher-chrome-footer flex shrink-0 items-center justify-between ${
            density === "compact"
              ? "px-[var(--launcher-footer-x)]"
              : "px-[var(--launcher-chrome-x-compact)]"
          }`}
          data-variant={footerVariant}
          style={{
            borderTop: footerVariant === "strip" ? "1px solid var(--launcher-border)" : "none",
            backgroundColor:
              footerVariant === "strip" ? "var(--launcher-footer-strip)" : "transparent",
            height: shellConfig.footerHeight
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
