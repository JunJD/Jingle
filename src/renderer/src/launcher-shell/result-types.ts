import type { LauncherResultKind } from "../../../shared/launcher"

export type LauncherShellItemKind = LauncherResultKind | "plugin" | "suggestion"

export type LauncherResultPresentationIconName =
  | "file-text"
  | "folder"
  | "globe"
  | "history"
  | "languages"
  | "search"
  | "sparkles"
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
