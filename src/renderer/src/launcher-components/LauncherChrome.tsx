import { type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"
import type { LauncherShellConfig } from "@shared/launcher"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import { LauncherChromeFrame } from "./LauncherChromeFrame"
import { LauncherInput } from "./LauncherInput"

interface LauncherChromeProps {
  children?: ReactNode
  density?: "default" | "compact"
  footer?: ReactNode
  headerLeading?: ReactNode
  headerTrailing?: ReactNode
  inputClassName?: string
  inputRef: RefObject<LauncherInputElement | null>
  inputStatus?: LauncherInputStatus
  inputValue: string
  onInputKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
  placeholders: readonly string[]
  shellConfig: LauncherShellConfig
  showHeaderDivider?: boolean
  surface: string
}

export function LauncherChrome(props: LauncherChromeProps): React.JSX.Element {
  const {
    children,
    density = "default",
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

  return (
    <LauncherChromeFrame
      footer={footer}
      density={density}
      headerLeading={headerLeading}
      headerMain={
        <LauncherInput
          ref={inputRef}
          density={density}
          status={inputStatus}
          value={inputValue}
          onChange={(event) => onInputValueChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholders={placeholders}
          className={cn(
            density === "compact"
              ? "flex-1 text-[17px] font-semibold tracking-[-0.025em] text-foreground"
              : "flex-1 text-[20px] font-semibold tracking-[-0.03em] text-foreground",
            inputClassName
          )}
          placeholderClassName={
            density === "compact"
              ? "text-[17px] font-semibold tracking-[-0.025em] text-muted-foreground/72"
              : "text-[20px] font-semibold tracking-[-0.03em] text-muted-foreground/75"
          }
        />
      }
      headerTrailing={headerTrailing}
      inputStatus={inputStatus}
      shellConfig={shellConfig}
      showHeaderDivider={showHeaderDivider}
      surface={surface}
    >
      {children}
    </LauncherChromeFrame>
  )
}
