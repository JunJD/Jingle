import type { LauncherResultKind } from "@shared/launcher"

export type LauncherShellItemKind = LauncherResultKind | "plugin" | "suggestion"

export type LauncherResultPresentationIconName =
  | "bell"
  | "check-circle"
  | "file-text"
  | "folder"
  | "github"
  | "globe"
  | "history"
  | "languages"
  | "reminders"
  | "search"
  | "sparkles"
  | "todo"
  | (string & {})

export type LauncherResultPresentationTone = "accent" | "brand" | "neutral"

export type LauncherResultPresentationIcon =
  | {
      name: LauncherResultPresentationIconName
      type: "glyph"
    }
  | {
      src: string
      type: "image"
    }

export interface LauncherResultPresentation {
  categoryLabel: string
  icon: LauncherResultPresentationIcon
  listActionLabel: string
  primaryActionLabel: string
  tone: LauncherResultPresentationTone
}
