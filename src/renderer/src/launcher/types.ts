import type { LauncherResultItem } from "../../../shared/launcher"
import type { LauncherSearchAction } from "../../../shared/launcher-search"

export interface LauncherShellItem extends LauncherResultItem {
  action: LauncherSearchAction
}
