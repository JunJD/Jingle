import { useRef, type ReactNode } from "react"
import type { LauncherShellConfig } from "@shared/launcher"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import { useLauncherChromeAudit } from "@launcher-shell/hooks/useLauncherChromeAudit"

interface LauncherChromeFrameProps {
  children?: ReactNode
  density?: "default" | "compact"
  footer?: ReactNode
  headerLeading?: ReactNode
  headerMain?: ReactNode
  headerTrailing?: ReactNode
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
    headerLeading,
    headerMain,
    headerTrailing,
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
          density === "compact" ? "gap-2 px-3" : "gap-2.5 px-4"
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
            className={`flex shrink-0 items-center ${density === "compact" ? "gap-2" : "gap-2.5"}`}
          >
            {headerTrailing}
          </div>
        ) : null}
      </div>

      {children}

      {footer ? (
        <div
          ref={footerRef}
          className={`launcher-chrome-footer flex shrink-0 items-center justify-between ${
            density === "compact" ? "px-3" : "px-3.5"
          }`}
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
