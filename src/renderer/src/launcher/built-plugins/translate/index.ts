import { createBuiltLauncherIntentPresentation, defineBuiltLauncherPlugin } from "../sdk"
import {
  TRANSLATE_INTENT_ID,
  TRANSLATE_MAIN_COMMAND_NAME,
  TRANSLATE_QUICK_COPY_COMMAND_NAME,
  TRANSLATE_QUICK_COPY_INTENT_ID,
  translateLauncherPluginManifest
} from "../../../../../plugins/translate/manifest"
import { LauncherTranslatePage } from "./TranslatePage"
import { getTranslatePluginCopy } from "./copy"
import { translateBuiltPluginClient } from "./api"
import {
  detectTranslateLanguageId,
  getTranslateLanguageOption,
  matchTranslateCommandQuery,
  matchTranslateIntent
} from "./languages"

export const translateLauncherPlugin = defineBuiltLauncherPlugin({
  commands: [
    {
      Component: LauncherTranslatePage,
      commandName: TRANSLATE_MAIN_COMMAND_NAME,
      mode: "view",
      search: {
        buildIntentItems: ({ copy, locale, query }) => {
          const pluginCopy = getTranslatePluginCopy(locale)
          const trimmedQuery = query.trim()
          const naturalIntentMatch = matchTranslateIntent(trimmedQuery)
          const commandSourceText = matchTranslateCommandQuery(trimmedQuery)

          if (!naturalIntentMatch && !commandSourceText) {
            return []
          }

          const previewText = naturalIntentMatch?.sourceText ?? commandSourceText ?? trimmedQuery

          return [
            {
              id: TRANSLATE_INTENT_ID,
              kind: "plugin",
              openOptions: {
                seedQuery: trimmedQuery
              },
              presentation: createBuiltLauncherIntentPresentation({
                categoryLabel: pluginCopy.searchItemCategoryLabel,
                icon: {
                  name: "languages",
                  type: "glyph"
                },
                listActionLabel: copy.launcher.openGeneric,
                primaryActionLabel: pluginCopy.searchItemPrimaryActionLabel,
                tone: "accent"
              }),
              priority: 100,
              subtitle: pluginCopy.searchItemSubtitle(previewText),
              title: pluginCopy.entryLabel
            }
          ]
        },
        resolveCommand: ({ key, query, altKey, ctrlKey, metaKey }) => {
          if (altKey || ctrlKey || metaKey) {
            return null
          }

          if (key !== " ") {
            return null
          }

          if (query.trim().toLowerCase() !== "yi") {
            return null
          }

          return {
            openOptions: {
              seedQuery: ""
            }
          }
        }
      },
      viewport: {
        bodyHeight: 392
      }
    },
    {
      commandName: TRANSLATE_QUICK_COPY_COMMAND_NAME,
      mode: "no-view",
      run: async ({ navigation, seedQuery }) => {
        const intentMatch = matchTranslateIntent(seedQuery.trim())

        if (!intentMatch) {
          navigation?.goHome()
          return
        }

        const sourceLanguageId = detectTranslateLanguageId(intentMatch.sourceText)
        const response = await translateBuiltPluginClient.translate({
          backend: {
            kind: "llm"
          },
          sourceLanguage: getTranslateLanguageOption(sourceLanguageId).promptLabel,
          targetLanguage: getTranslateLanguageOption(intentMatch.targetLanguageId).promptLabel,
          text: intentMatch.sourceText
        })

        await navigator.clipboard.writeText(response.translatedText)
        navigation?.goHome()
      },
      search: {
        buildIntentItems: ({ locale, query }) => {
          const pluginCopy = getTranslatePluginCopy(locale)
          const trimmedQuery = query.trim()
          const naturalIntentMatch = matchTranslateIntent(trimmedQuery)

          if (!naturalIntentMatch) {
            return []
          }

          return [
            {
              id: TRANSLATE_QUICK_COPY_INTENT_ID,
              kind: "plugin",
              openOptions: {
                seedQuery: trimmedQuery
              },
              presentation: createBuiltLauncherIntentPresentation({
                categoryLabel: pluginCopy.searchItemCategoryLabel,
                icon: {
                  name: "copy",
                  type: "glyph"
                },
                primaryActionLabel: pluginCopy.quickCopyPrimaryActionLabel,
                tone: "accent"
              }),
              priority: 95,
              subtitle: pluginCopy.quickCopySubtitle(
                naturalIntentMatch.sourceText,
                naturalIntentMatch.targetLabel
              ),
              title: pluginCopy.quickCopyEntryLabel
            }
          ]
        }
      }
    }
  ],
  manifest: translateLauncherPluginManifest
})
