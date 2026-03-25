import type { LauncherResultItem } from "../../../shared/launcher"
import type { LauncherSearchAction } from "../../../shared/launcher-search"
import type { LauncherFeaturePageId } from "./pages/types"

export interface LauncherShellItem extends LauncherResultItem {
  action: LauncherSearchAction
  featurePageId?: LauncherFeaturePageId
}
