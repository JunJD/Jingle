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
  inputTrailing?: ReactNode
  inputValue: string
  onInputKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onInputValueChange: (value: string) => void
  placeholders: readonly string[]
  shellConfig: LauncherShellConfig
  showInputStatusIndicator?: boolean
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
    inputTrailing,
    inputValue,
    onInputKeyDown,
    onInputValueChange,
    placeholders,
    shellConfig,
    showInputStatusIndicator = true,
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
          trailing={inputTrailing}
          showStatusIndicator={showInputStatusIndicator}
          status={inputStatus}
          value={inputValue}
          onChange={(event) => onInputValueChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholders={placeholders}
          className={cn(
            density === "compact"
              ? "flex-1 text-[15px] font-medium text-foreground"
              : "flex-1 text-[16px] font-medium text-foreground",
            inputClassName
          )}
          placeholderClassName={
            density === "compact"
              ? "text-[15px] font-medium text-muted-foreground/64"
              : "text-[16px] font-medium text-muted-foreground/68"
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
