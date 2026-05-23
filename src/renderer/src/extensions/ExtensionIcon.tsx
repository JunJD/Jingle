import {
  Bell,
  CheckCircle2,
  FileText,
  Folder,
  Github,
  Globe,
  History,
  Languages,
  ListTodo,
  Puzzle,
  Search,
  Sparkles
} from "lucide-react"
import type { LauncherResultPresentationIconName } from "@shared/launcher"
import { getExtensionIconAssetSrc } from "./extension-icon-assets"

type ExtensionIconName = LauncherResultPresentationIconName | "gear" | "plus" | "refresh"

function TodoGlyph(props: { className?: string }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={props.className}
      fill="none"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        height="13.6"
        rx="3.4"
        stroke="currentColor"
        strokeWidth="2"
        width="13.6"
        x="2.2"
        y="2.2"
      />
      <path
        d="M8.8 5.6v3.2l2.3 1.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function renderGlyphIcon(
  iconName: ExtensionIconName | undefined,
  className: string
): React.JSX.Element {
  switch (iconName) {
    case "bell":
      return <Bell className={className} aria-hidden="true" />
    case "check-circle":
      return <CheckCircle2 className={className} aria-hidden="true" />
    case "file-text":
      return <FileText className={className} aria-hidden="true" />
    case "folder":
      return <Folder className={className} aria-hidden="true" />
    case "github":
      return <Github className={className} aria-hidden="true" />
    case "globe":
      return <Globe className={className} aria-hidden="true" />
    case "history":
      return <History className={className} aria-hidden="true" />
    case "languages":
      return <Languages className={className} aria-hidden="true" />
    case "reminders":
      return <ListTodo className={className} aria-hidden="true" />
    case "sparkles":
      return <Sparkles className={className} aria-hidden="true" />
    case "todo":
      return <TodoGlyph className={className} />
    case "search":
      return <Search className={className} aria-hidden="true" />
    default:
      return <Puzzle className={className} aria-hidden="true" />
  }
}

export function ExtensionIcon(props: {
  className?: string
  extensionName?: string
  icon?: string
  iconName?: ExtensionIconName
}): React.JSX.Element {
  const { className = "size-4", extensionName, icon, iconName } = props
  const src = getExtensionIconAssetSrc({ extensionName, icon })

  if (src) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={className}
        src={src}
        style={{ display: "inline-block", objectFit: "contain" }}
      />
    )
  }

  return renderGlyphIcon(iconName, className)
}
