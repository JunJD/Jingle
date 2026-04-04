import type { LauncherResultAvailability } from "../../../shared/launcher"
import type { LauncherSearchAction } from "../../../shared/launcher-search"
import type { LauncherResultPresentation, LauncherShellItemKind } from "./result-types"
import type {
  LauncherCommandAddress,
  LauncherCommandOpenOptions
} from "./pages/types"

export interface LauncherShellItem {
  action: LauncherSearchAction
  availability?: LauncherResultAvailability
  command?: {
    type: "replace-query"
    value: string
  }
  commandOpenOptions?: LauncherCommandOpenOptions
  commandRef?: LauncherCommandAddress
  kind: LauncherShellItemKind
  id: string
  iconDataUrl?: string
  match?: [number, number]
  pin?: boolean
  presentation: LauncherResultPresentation
  subtitle: string
  title: string
}
