import { useMemo } from "react"
import type { AppLocale } from "@shared/i18n"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import { listNativeLauncherSourceMentions } from "./index"

export function useNativeSourceMentionsProjection(locale: AppLocale): ExtensionSourceMention[] {
  return useMemo(
    () => listNativeLauncherSourceMentions(window.electron.process.platform, locale),
    [locale]
  )
}
