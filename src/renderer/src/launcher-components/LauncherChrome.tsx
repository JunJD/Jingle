import { useMemo, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"
import type { LauncherShellConfig } from "@shared/launcher"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import { LauncherChromeFrame } from "./LauncherChromeFrame"
import { LauncherInput } from "./LauncherInput"

interface LauncherChromeProps {
  children?: ReactNode
  footer?: ReactNode
  footerVariant?: "strip" | "composer"
  headerLeading?: ReactNode
  headerTrailing?: ReactNode
  hideInputChrome?: boolean
  inputAccessory?: ReactNode
  inputClassName?: string
  inputMultiline?: boolean
  inputReplacement?: ReactNode
  inputRef?:
    | RefObject<LauncherInputElement | null>
    | ((element: LauncherInputElement | null) => void)
  inputStatus?: LauncherInputStatus
  inputTrailing?: ReactNode
  inputValue: string
  onInputKeyDown?: (event: React.KeyboardEvent<LauncherInputElement>) => void
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
    footer,
    footerVariant,
    headerLeading,
    headerTrailing,
    hideInputChrome = false,
    inputAccessory,
    inputClassName,
    inputMultiline = false,
    inputReplacement,
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
  const headerMain = useMemo(() => {
    if (hideInputChrome) {
      return null
    }

    if (inputReplacement) {
      return inputReplacement
    }

    return (
      <LauncherInput
        ref={inputRef}
        multiline={inputMultiline}
        trailing={inputTrailing}
        showStatusIndicator={showInputStatusIndicator}
        status={inputStatus}
        value={inputValue}
        onChange={(event) => onInputValueChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholders={placeholders}
        className={cn(
          "flex-1 [font-size:var(--ow-font-control)] font-medium text-foreground",
          inputClassName
        )}
        placeholderClassName="[font-size:var(--ow-font-control)] font-medium text-muted-foreground/64"
      />
    )
  }, [
    hideInputChrome,
    inputClassName,
    inputMultiline,
    inputRef,
    inputReplacement,
    inputStatus,
    inputTrailing,
    inputValue,
    onInputKeyDown,
    onInputValueChange,
    placeholders,
    showInputStatusIndicator
  ])

  return (
    <LauncherChromeFrame
      footer={footer}
      footerVariant={footerVariant}
      headerLeading={headerLeading}
      headerMain={headerMain}
      headerTrailing={headerTrailing}
      inputAccessory={inputAccessory}
      inputStatus={inputStatus}
      shellConfig={shellConfig}
      showHeaderDivider={showHeaderDivider}
      surface={surface}
    >
      {children}
    </LauncherChromeFrame>
  )
}
