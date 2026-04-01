import {
  EXTENSIONS_LAB_COMMAND_NAME,
  EXTENSIONS_LAB_INTENT_ID,
  extensionsLabLauncherPluginManifest
} from "../../../../../plugins/extensions-lab/manifest"
import { defineBuiltLauncherPlugin } from "../sdk"
import { ExtensionsLabPage } from "./ExtensionsLabPage"

const EXTENSIONS_LAB_QUERY_PATTERN = /\b(extension|extensions|raycast|plugin|plugins)\b/i

export const extensionsLabLauncherPlugin = defineBuiltLauncherPlugin({
  commands: [
    {
      Component: ExtensionsLabPage,
      commandName: EXTENSIONS_LAB_COMMAND_NAME,
      mode: "view",
      search: {
        buildIntentItems: ({ copy, query }) => {
          if (!EXTENSIONS_LAB_QUERY_PATTERN.test(query)) {
            return []
          }

          return [
            {
              id: EXTENSIONS_LAB_INTENT_ID,
              kind: "plugin",
              presentation: {
                categoryLabel: "Extension Runtime",
                icon: {
                  name: "boxes",
                  type: "glyph"
                },
                listActionLabel: copy.launcher.openGeneric,
                primaryActionLabel: "Open Extensions Lab",
                tone: "accent"
              },
              priority: 85,
              subtitle: "Browse and run vendored Raycast-style extension commands.",
              title: "Extensions Lab"
            }
          ]
        }
      },
      viewport: {
        bodyHeight: 520
      }
    }
  ],
  manifest: extensionsLabLauncherPluginManifest
})
