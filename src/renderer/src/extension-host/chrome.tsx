import { ArrowLeft } from "lucide-react"
import { type ReactNode } from "react"
import { LauncherChromeFrame } from "@launcher-components/LauncherChromeFrame"
import { useNativeExtensionNavigation, useNativeExtensionSurface } from "./sdk"

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

  return (
    <LauncherChromeFrame
      footer={footer}
      headerLeading={headerLeading}
      headerMain={
        title ? (
          <div className="truncate [font-size:var(--jingle-font-title)] font-semibold tracking-normal text-foreground">
            {title}
          </div>
        ) : null
      }
      headerTrailing={headerTrailing}
      shellConfig={shell.shellConfig}
      showHeaderDivider={showHeaderDivider}
      surface={surface}
    >
      {children}
    </LauncherChromeFrame>
  )
}

export function NativeSurfaceBackButton(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()

  return (
    <button
      type="button"
      onClick={navigation.canPop ? navigation.pop : navigation.goHome}
      onMouseDown={(event) => event.preventDefault()}
      className="launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
      aria-label={navigation.canPop ? "Go Back" : "Go Home"}
    >
      <ArrowLeft className="size-[var(--jingle-icon-sm)]" />
    </button>
  )
}

export function NativeSurfaceHeaderLeading(props: { label?: string }): React.JSX.Element {
  const { label } = props

  return (
    <div className="flex min-w-0 items-center gap-[var(--jingle-gap-sm)]">
      <NativeSurfaceBackButton />
      {label ? (
        <span className="truncate [font-size:var(--jingle-font-body)] font-medium text-muted-foreground">
          {label}
        </span>
      ) : null}
    </div>
  )
}
