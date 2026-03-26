import type { LauncherResultItem } from "../../../shared/launcher"
import type { LauncherSearchAction } from "../../../shared/launcher-search"
import type { LauncherPluginId, LauncherPluginOpenOptions } from "./pages/types"

export interface LauncherShellItem extends LauncherResultItem {
  action: LauncherSearchAction
  pluginId?: LauncherPluginId
  pluginOpenOptions?: LauncherPluginOpenOptions
  priority?: number
}
