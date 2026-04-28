import { useCallback, useEffect, useState } from "react"
import { Keyboard, KeyRound, Puzzle, Settings2 } from "lucide-react"
import type { SettingsWindowTab, SettingsWindowTarget } from "@shared/settings-window"
import { useI18n } from "../lib/i18n"
import { getSettingsCopy } from "./copy"
import { ExtensionsTab } from "./ExtensionsTab"
import { GeneralTab } from "./GeneralTab"
import { ProviderTab, preloadProviderTabData } from "./ProviderTab"
import { ShortcutsTab } from "./ShortcutsTab"

const settingsScrollPaneClassName =
  "h-full overflow-x-hidden overflow-y-auto pr-[var(--ow-space-1)] [scrollbar-gutter:stable]"

export default function SettingsApp(): React.JSX.Element {
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [activeTab, setActiveTab] = useState<SettingsWindowTab>("general")
  const [focusTarget, setFocusTarget] = useState<SettingsWindowTarget | null>(null)

  const handleFocusTargetConsumed = useCallback(() => {
    setFocusTarget(null)
  }, [])

  useEffect(() => {
    preloadProviderTabData()

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
    <div className="settings-app flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="app-drag-region flex h-[var(--ow-control-h-lg)] shrink-0 items-center border-b border-border bg-[var(--window-chrome)] px-[var(--ow-space-4)]">
        <div
          className="flex min-w-0 flex-1 items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] font-semibold tracking-[0.08em] text-[var(--window-chrome-foreground)]"
          style={{ paddingLeft: "calc(var(--window-controls-offset-inline) + 6px)" }}
        >
          <Settings2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
          <span>{copy.title}</span>
        </div>

        <div className="app-no-drag inline-flex items-stretch overflow-hidden rounded-[var(--ow-radius-md)] border border-border bg-background-elevated shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            data-settings-tab="general"
            className={`inline-flex items-center gap-[var(--ow-gap-sm)] px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] font-medium transition ${
              activeTab === "general"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
            }`}
          >
            <Settings2 className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.general}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("provider")}
            data-settings-tab="provider"
            className={`inline-flex items-center gap-[var(--ow-gap-sm)] border-l border-border px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] font-medium transition ${
              activeTab === "provider"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
            }`}
          >
            <KeyRound className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.provider}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("extensions")}
            data-settings-tab="extensions"
            className={`inline-flex items-center gap-[var(--ow-gap-sm)] border-l border-border px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] font-medium transition ${
              activeTab === "extensions"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
            }`}
          >
            <Puzzle className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.extensions}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shortcuts")}
            data-settings-tab="shortcuts"
            className={`inline-flex items-center gap-[var(--ow-gap-sm)] border-l border-border px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] font-medium transition ${
              activeTab === "shortcuts"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
            }`}
          >
            <Keyboard className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.shortcuts}
          </button>
        </div>

        <div className="flex min-w-0 flex-1 justify-end [font-size:var(--ow-font-body)] text-[var(--window-chrome-muted)]">
          Openwork
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-[var(--ow-space-4)]">
        {activeTab === "general" ? (
          <div className={settingsScrollPaneClassName}>
            <GeneralTab locale={locale} />
          </div>
        ) : activeTab === "provider" ? (
          <div className={settingsScrollPaneClassName}>
            <ProviderTab
              focusTarget={focusTarget}
              onFocusTargetConsumed={handleFocusTargetConsumed}
            />
          </div>
        ) : activeTab === "shortcuts" ? (
          <div className={settingsScrollPaneClassName}>
            <ShortcutsTab locale={locale} />
          </div>
        ) : (
          <ExtensionsTab focusTarget={focusTarget} locale={locale} />
        )}
      </div>
    </div>
  )
}
