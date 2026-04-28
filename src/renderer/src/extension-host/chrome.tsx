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
      density="compact"
      footer={footer}
      headerLeading={headerLeading}
      headerMain={
        title ? (
          <div className="truncate text-[14px] font-semibold tracking-normal text-foreground">
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
      className="launcher-icon-button flex h-7 w-7 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
      aria-label={navigation.canPop ? "Go Back" : "Go Home"}
    >
      <ArrowLeft className="size-3.5" />
    </button>
  )
}

export function NativeSurfaceHeaderLeading(props: { label?: string }): React.JSX.Element {
  const { label } = props

  return (
    <div className="flex min-w-0 items-center gap-2">
      <NativeSurfaceBackButton />
      {label ? (
        <span className="truncate text-[var(--ow-font-body)] font-medium text-muted-foreground">
          {label}
        </span>
      ) : null}
    </div>
  )
}
