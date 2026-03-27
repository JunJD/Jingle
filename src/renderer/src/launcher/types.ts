import type { LauncherResultAvailability } from "../../../shared/launcher"
import type { LauncherSearchAction } from "../../../shared/launcher-search"
import type { LauncherResultPresentation, LauncherShellItemKind } from "./result-types"
import type { LauncherPluginId, LauncherPluginOpenOptions } from "./pages/types"

export interface LauncherShellItem {
  action: LauncherSearchAction
  availability?: LauncherResultAvailability
  pluginId?: LauncherPluginId
  pluginOpenOptions?: LauncherPluginOpenOptions
  kind: LauncherShellItemKind
  id: string
  match?: [number, number]
  presentation: LauncherResultPresentation
  priority?: number
  subtitle: string
  title: string
}
