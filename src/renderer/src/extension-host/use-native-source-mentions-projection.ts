import { useMemo } from "react"
import type { AppLocale } from "@shared/i18n"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import { listNativeLauncherSourceMentions, useNativeExtensionProjectionRevision } from "./index"

export function useNativeSourceMentionsProjection(locale: AppLocale): ExtensionSourceMention[] {
  const projectionRevision = useNativeExtensionProjectionRevision()
  return useMemo(() => {
    void projectionRevision
    return listNativeLauncherSourceMentions(window.electron.process.platform, locale)
  }, [locale, projectionRevision])
}
