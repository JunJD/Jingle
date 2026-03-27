import type { LauncherPluginDefinition } from "../pages/types"
import { aiLauncherPlugin } from "./ai"
import { translateLauncherPlugin } from "./translate"

export const builtLauncherPlugins: LauncherPluginDefinition[] = [
  aiLauncherPlugin,
  translateLauncherPlugin
]
