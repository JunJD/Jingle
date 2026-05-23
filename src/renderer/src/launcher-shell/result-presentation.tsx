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
  NotebookText,
  Search,
  Sparkles
} from "lucide-react"
import type { AppCopy } from "@/lib/i18n/messages"
import type { LauncherResultAvailability, LauncherResultKind } from "@shared/launcher"
import type {
  LauncherResultPresentation,
  LauncherResultPresentationIcon,
  LauncherResultPresentationTone
} from "./result-types"

function TodoGlyph(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
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

function getBuiltinResultActionLabel(params: {
  availability?: LauncherResultAvailability
  copy: AppCopy
  kind: LauncherResultKind
}): { listActionLabel: string; primaryActionLabel: string } {
  const { availability, copy, kind } = params
  if (availability === "planned") {
    return {
      listActionLabel: copy.launcher.planned,
      primaryActionLabel: copy.launcher.planned
    }
  }

  if (kind === "ai") {
    return {
      listActionLabel: copy.launcher.openGeneric,
      primaryActionLabel: copy.launcher.aiPrimaryLabel
    }
  }

  if (kind === "application") {
    return {
      listActionLabel: copy.launcher.enter,
      primaryActionLabel: copy.launcher.openApp
    }
  }

  if (kind === "url") {
    return {
      listActionLabel: copy.launcher.openGeneric,
      primaryActionLabel: copy.launcher.openGeneric
    }
  }

  return {
    listActionLabel: copy.launcher.openGeneric,
    primaryActionLabel: copy.launcher.openGeneric
  }
}

function getBuiltinResultCategoryLabel(copy: AppCopy, kind: LauncherResultKind): string {
  switch (kind) {
    case "application":
      return copy.launcher.resultKindApp
    case "file":
      return copy.launcher.resultKindFile
    case "url":
      return copy.launcher.resultKindUrl
    case "directory":
      return copy.launcher.resultKindDirectory
    case "ai":
      return copy.launcher.resultKindAgent
    case "history":
    default:
      return copy.launcher.resultKindThread
  }
}

function getBuiltinResultIcon(params: {
  iconDataUrl?: string
  kind: LauncherResultKind
}): LauncherResultPresentationIcon {
  const { iconDataUrl, kind } = params
  if (iconDataUrl && kind === "application") {
    return {
      src: iconDataUrl,
      type: "image"
    }
  }

  switch (kind) {
    case "file":
      return {
        name: "file-text",
        type: "glyph"
      }
    case "url":
      return {
        name: "globe",
        type: "glyph"
      }
    case "directory":
      return {
        name: "folder",
        type: "glyph"
      }
    case "ai":
      return {
        name: "sparkles",
        type: "glyph"
      }
    case "history":
      return {
        name: "history",
        type: "glyph"
      }
    case "application":
    default:
      return {
        name: "search",
        type: "glyph"
      }
  }
}

function getBuiltinResultTone(kind: LauncherResultKind): LauncherResultPresentationTone {
  if (kind === "application") {
    return "brand"
  }

  if (kind === "ai") {
    return "accent"
  }

  return "neutral"
}

export function getLauncherResultToneStyle(
  tone: LauncherResultPresentationTone
): React.CSSProperties {
  switch (tone) {
    case "brand":
      return {
        backgroundColor: "var(--launcher-app-chip-bg)",
        color: "var(--launcher-app-chip-fg)"
      }
    case "accent":
      return {
        backgroundColor: "var(--launcher-ai-chip-bg)",
        color: "var(--launcher-ai-chip-fg)"
      }
    case "neutral":
    default:
      return {
        backgroundColor: "var(--launcher-history-chip-bg)",
        color: "var(--launcher-history-chip-fg)"
      }
  }
}

export function renderLauncherResultIcon(icon: LauncherResultPresentationIcon): React.JSX.Element {
  if (icon.type === "image") {
    return <img src={icon.src} alt="" className="h-5 w-5 object-contain" />
  }

  switch (icon.name) {
    case "bell":
      return <Bell className="size-4" />
    case "check-circle":
      return <CheckCircle2 className="size-4" />
    case "file-text":
      return <FileText className="size-4" />
    case "folder":
      return <Folder className="size-4" />
    case "github":
      return <Github className="size-4" />
    case "globe":
      return <Globe className="size-4" />
    case "history":
      return <History className="size-4" />
    case "languages":
      return <Languages className="size-4" />
    case "notion":
      return <NotebookText className="size-4" />
    case "reminders":
      return <ListTodo className="size-4" />
    case "sparkles":
      return <Sparkles className="size-4" />
    case "todo":
      return <TodoGlyph />
    case "search":
    default:
      return <Search className="size-4" />
  }
}

export function createLauncherBuiltinResultPresentation(params: {
  availability?: LauncherResultAvailability
  copy: AppCopy
  iconDataUrl?: string
  kind: LauncherResultKind
}): LauncherResultPresentation {
  const { availability, copy, iconDataUrl, kind } = params
  const actionLabels = getBuiltinResultActionLabel({
    availability,
    copy,
    kind
  })

  return {
    categoryLabel: getBuiltinResultCategoryLabel(copy, kind),
    icon: getBuiltinResultIcon({
      iconDataUrl,
      kind
    }),
    listActionLabel: actionLabels.listActionLabel,
    primaryActionLabel: actionLabels.primaryActionLabel,
    tone: getBuiltinResultTone(kind)
  }
}
