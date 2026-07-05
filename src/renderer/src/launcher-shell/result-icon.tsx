import {
  Bell,
  Bookmark,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  History,
  Sparkles
} from "lucide-react"
import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import type { LauncherResultPresentationIcon } from "./result-types"

export function LauncherResultIconGraphic(props: {
  icon: LauncherResultPresentationIcon
}): React.JSX.Element {
  const { icon } = props

  if (icon.type === "image") {
    return <img src={icon.src} alt="" className="h-5 w-5 object-contain" />
  }

  if (icon.type === "extension") {
    return (
      <ExtensionIcon
        className="size-4"
        extensionName={icon.extensionName}
        icon={icon.icon}
        iconName={icon.iconName}
      />
    )
  }

  switch (icon.name) {
    case "bell":
      return <Bell className="size-4" />
    case "bookmark":
      return <Bookmark className="size-4" />
    case "check-circle":
      return <CheckCircle2 className="size-4" />
    case "file-text":
      return <FileText className="size-4" />
    case "external-link":
      return <ExternalLink className="size-4" />
    case "folder":
      return <Folder className="size-4" />
    case "globe":
      return <Globe className="size-4" />
    case "history":
      return <History className="size-4" />
    case "sparkles":
      return <Sparkles className="size-4" />
    case "search":
    case "github":
    case "languages":
    case "reminders":
    case "todo":
    default:
      return <ExtensionIcon className="size-4" iconName={icon.name} />
  }
}
