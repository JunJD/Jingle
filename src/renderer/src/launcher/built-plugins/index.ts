import type { LauncherPluginDefinition } from "../pages/types"
import { aiLauncherPlugin } from "./ai"
import { extensionsLabLauncherPlugin } from "./extensions-lab"
import { translateLauncherPlugin } from "./translate"

export const builtLauncherPlugins: LauncherPluginDefinition[] = [
  aiLauncherPlugin,
  extensionsLabLauncherPlugin,
  translateLauncherPlugin
]
