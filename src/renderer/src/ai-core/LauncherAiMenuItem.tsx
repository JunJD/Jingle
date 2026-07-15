import * as DropdownMenu from "@/components/ui/dropdown-menu"
import type { ReactNode } from "react"

function preventDefaultSelect(event: Event): void {
  event.preventDefault()
}

export function LauncherAiMenuItem(props: {
  children: ReactNode
  disabled?: boolean
  icon: ReactNode
  onSelect?: (event: Event) => void
  shortcut?: string
}): React.JSX.Element {
  const { children, disabled = false, icon, onSelect, shortcut } = props

  return (
    <DropdownMenu.Item
      className="launcher-ai-menu__item"
      disabled={disabled}
      onSelect={onSelect ?? preventDefaultSelect}
    >
      <span className="launcher-ai-menu__icon">{icon}</span>
      <span className="launcher-ai-menu__label">{children}</span>
      {shortcut ? <span className="launcher-ai-menu__shortcut">{shortcut}</span> : null}
    </DropdownMenu.Item>
  )
}
