import { useEffect, useState } from "react"
import { Keyboard, Puzzle, Settings2 } from "lucide-react"
import type { SettingsWindowTab, SettingsWindowTarget } from "../../../shared/settings-window"
import { useI18n } from "../lib/i18n"
import { getSettingsCopy } from "./copy"
import { ExtensionsTab } from "./ExtensionsTab"
import { GeneralTab } from "./GeneralTab"
import { ShortcutsTab } from "./ShortcutsTab"

export default function SettingsApp(): React.JSX.Element {
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [activeTab, setActiveTab] = useState<SettingsWindowTab>("general")
  const [focusTarget, setFocusTarget] = useState<SettingsWindowTarget | null>(null)

  useEffect(() => {
    void window.api.settings.getPendingNavigation().then((payload) => {
      if (!payload) {
        return
      }

      setActiveTab(payload.tab)
      setFocusTarget(payload.target ?? null)
    })

    return window.electron.onSettingsTabChanged((payload) => {
      setActiveTab(payload.tab)
      setFocusTarget(payload.target ?? null)
    })
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="app-drag-region flex h-[52px] shrink-0 items-center border-b border-border bg-[var(--window-chrome)] px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-[var(--window-chrome-foreground)]">
          <Settings2 className="h-4 w-4" />
          <span>{copy.title}</span>
        </div>

        <div className="app-no-drag inline-flex items-stretch overflow-hidden rounded-lg border border-border bg-background-elevated shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            data-settings-tab="general"
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium transition ${
              activeTab === "general"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {copy.tabs.general}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("extensions")}
            data-settings-tab="extensions"
            className={`inline-flex items-center gap-2 border-l border-border px-3 py-1.5 text-[12px] font-medium transition ${
              activeTab === "extensions"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
            }`}
          >
            <Puzzle className="h-3.5 w-3.5" />
            {copy.tabs.extensions}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shortcuts")}
            data-settings-tab="shortcuts"
            className={`inline-flex items-center gap-2 border-l border-border px-3 py-1.5 text-[12px] font-medium transition ${
              activeTab === "shortcuts"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
            }`}
          >
            <Keyboard className="h-3.5 w-3.5" />
            {copy.tabs.shortcuts}
          </button>
        </div>

        <div className="flex min-w-0 flex-1 justify-end text-[12px] text-[var(--window-chrome-muted)]">
          Openwork
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-5">
        {activeTab === "general" ? (
          <div className="h-full overflow-y-auto pr-1">
            <GeneralTab locale={locale} />
          </div>
        ) : activeTab === "shortcuts" ? (
          <div className="h-full overflow-y-auto pr-1">
            <ShortcutsTab locale={locale} />
          </div>
        ) : (
          <ExtensionsTab focusTarget={focusTarget} locale={locale} />
        )}
      </div>
    </div>
  )
}
