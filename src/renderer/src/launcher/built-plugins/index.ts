import type { LauncherPluginDefinition } from "../pages/types"
import { aiLauncherPlugin } from "./ai"
import { nativeLauncherPlugins } from "../native-extensions"

export const builtLauncherPlugins: LauncherPluginDefinition[] = [
  aiLauncherPlugin,
  ...nativeLauncherPlugins
]
