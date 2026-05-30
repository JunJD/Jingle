import React, { useState } from "react"
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  Github,
  Globe,
  History,
  Languages,
  ListTodo,
  NotebookText,
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
    case "external-link":
      return <ExternalLink className={className} aria-hidden="true" />
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
    case "notion":
      return <NotebookText className={className} aria-hidden="true" />
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
    return <ExtensionAssetIcon className={className} fallbackIconName={iconName} src={src} />
  }

  return renderGlyphIcon(iconName, className)
}

function ExtensionAssetIcon(props: {
  className: string
  fallbackIconName: ExtensionIconName | undefined
  src: string
}): React.JSX.Element {
  const { className, fallbackIconName, src } = props
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  const isLoaded = loadedSrc === src
  const hasFailed = failedSrc === src

  return (
    <span className={`${className} relative inline-flex shrink-0 items-center justify-center`}>
      {isLoaded && !hasFailed ? null : renderGlyphIcon(fallbackIconName, className)}
      {hasFailed ? null : (
        <img
          alt=""
          aria-hidden="true"
          onError={() => setFailedSrc(src)}
          onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setLoadedSrc(src)
              return
            }

            setFailedSrc(src)
          }}
          src={src}
          style={{
            display: "block",
            height: "100%",
            inset: 0,
            objectFit: "contain",
            opacity: isLoaded ? 1 : 0,
            position: "absolute",
            width: "100%"
          }}
        />
      )}
    </span>
  )
}
