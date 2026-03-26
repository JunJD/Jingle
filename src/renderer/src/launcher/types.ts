import type { LauncherResultItem } from "../../../shared/launcher"
import type { LauncherSearchAction } from "../../../shared/launcher-search"
import type { LauncherPluginId } from "./pages/types"

export interface LauncherShellItem extends LauncherResultItem {
  action: LauncherSearchAction
  pluginId?: LauncherPluginId
}
