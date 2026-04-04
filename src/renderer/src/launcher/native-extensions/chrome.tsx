import { ArrowLeft } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { useLauncherChromeAudit } from "../hooks/useLauncherChromeAudit"
import type { NativeActionDescriptor } from "./actions"
import { useNativeExtensionNavigation, useNativeExtensionSurface } from "./sdk"
import { NativeActionOverlay } from "./ui"

export function NativeSurfaceChrome(props: {
  children?: ReactNode
  footer?: ReactNode
  headerLeading?: ReactNode
  headerTrailing?: ReactNode
  showHeaderDivider?: boolean
  surface: string
  title?: string
}): React.JSX.Element {
  const {
    children,
    footer,
    headerLeading,
    headerTrailing,
    showHeaderDivider = true,
    surface,
    title
  } = props
  const shell = useNativeExtensionSurface()
  const headerRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  useLauncherChromeAudit({
    footerRef,
    hasFooter: footer !== undefined,
    headerRef,
    shellConfig: shell.shellConfig,
    surface
  })

  return (
    <div className="launcher-chrome flex h-full w-full flex-col" data-surface={surface}>
      <div
        ref={headerRef}
        className="launcher-chrome-header flex shrink-0 items-center gap-3 px-6"
        style={{
          borderBottom: showHeaderDivider ? "1px solid var(--launcher-border)" : "none",
          height: shell.shellConfig.headerHeight
        }}
      >
        {headerLeading ? <div className="flex shrink-0 items-center">{headerLeading}</div> : null}

        <div className="min-w-0 flex-1">
          {title ? (
            <div className="truncate text-[20px] font-semibold tracking-[-0.03em] text-foreground">
              {title}
            </div>
          ) : null}
        </div>

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
            height: shell.shellConfig.footerHeight
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export function NativeSurfaceBackButton(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()

  return (
    <button
      type="button"
      onClick={navigation.canPop ? navigation.pop : navigation.goHome}
      onMouseDown={(event) => event.preventDefault()}
      className="launcher-icon-button flex h-9 w-9 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
      aria-label={navigation.canPop ? "Go Back" : "Go Home"}
    >
      <ArrowLeft className="size-5" />
    </button>
  )
}

export function NativeSurfaceActionsFooter(props: {
  actions: NativeActionDescriptor[]
  label: string
}): React.JSX.Element {
  const { actions, label } = props
  const [showActions, setShowActions] = useState(false)
  const primaryAction = actions[0] ?? null

  return (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <div className="truncate text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {actions.length > 1 ? (
          <button
            type="button"
            onClick={() => setShowActions(true)}
            onMouseDown={(event) => event.preventDefault()}
            className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground"
          >
            <span>Actions</span>
            <span className="launcher-shortcut text-[11px] text-muted-foreground">⌘K</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => {
            if (primaryAction) {
              void Promise.resolve(primaryAction.onAction())
            }
          }}
          onMouseDown={(event) => event.preventDefault()}
          disabled={!primaryAction}
          className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground disabled:opacity-40"
        >
          <span>{primaryAction?.title ?? "Open"}</span>
          <span className="launcher-shortcut text-[11px] text-muted-foreground">↵</span>
        </button>
      </div>

      {showActions && actions.length > 1 ? (
        <NativeActionOverlay actions={actions} onClose={() => setShowActions(false)} />
      ) : null}
    </>
  )
}
