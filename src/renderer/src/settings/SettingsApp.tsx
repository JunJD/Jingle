import { useCallback, useEffect, useState } from "react"
import { Archive, Brain, Keyboard, KeyRound, Link2, Palette, Puzzle, Settings2 } from "lucide-react"
import type { SettingsWindowTab, SettingsWindowTarget } from "@shared/settings-window"
import { useI18n } from "@/lib/i18n"
import { AppearanceTab } from "./AppearanceTab"
import { ArchivedThreadsTab } from "./ArchivedThreadsTab"
import { getSettingsCopy } from "./copy"
import { ExtensionsTab } from "./ExtensionsTab"
import { GeneralTab } from "./GeneralTab"
import { MemoryTab } from "./MemoryTab"
import { ProviderTab } from "./ProviderTab"
import { preloadModelSetupSnapshot } from "@/features/model-provider/model-setup/useModelSetupController"
import { QuicklinksTab } from "./QuicklinksTab"
import { ShortcutsTab } from "./ShortcutsTab"

const settingsScrollPaneClassName =
  "h-full overflow-x-hidden overflow-y-auto pr-[var(--ow-space-1)] [scrollbar-gutter:stable]"

function getSettingsTabClassName(active: boolean, withBorder = true): string {
  return [
    "inline-flex items-center gap-[var(--ow-gap-sm)] px-[var(--ow-settings-tab-x)] py-[var(--ow-settings-tab-y)] [font-size:var(--ow-settings-tab-font)] font-medium transition",
    withBorder ? "border-l border-border" : "",
    active
      ? "bg-background text-foreground"
      : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
  ]
    .filter(Boolean)
    .join(" ")
}

export default function SettingsApp(): React.JSX.Element {
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [activeTab, setActiveTab] = useState<SettingsWindowTab>("general")
  const [focusTarget, setFocusTarget] = useState<SettingsWindowTarget | null>(null)

  const handleFocusTargetConsumed = useCallback(() => {
    setFocusTarget(null)
  }, [])

  useEffect(() => {
    preloadModelSetupSnapshot()

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
      <div className="app-drag-region flex h-[var(--ow-settings-toolbar-h)] shrink-0 items-center border-b border-border bg-[var(--window-chrome)] px-[var(--ow-settings-window-pad)]">
        <div
          className="flex min-w-0 flex-1 items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-settings-tab-font)] font-semibold tracking-[0.05em] text-[var(--window-chrome-foreground)]"
          style={{ paddingLeft: "calc(var(--window-controls-offset-inline) + 6px)" }}
        >
          <Settings2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
          <span>{copy.title}</span>
        </div>

        <div className="app-no-drag inline-flex items-stretch overflow-hidden rounded-[var(--ow-settings-nav-radius)] border border-border bg-background-elevated shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            data-settings-tab="general"
            className={getSettingsTabClassName(activeTab === "general", false)}
          >
            <Settings2 className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.general}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("appearance")}
            data-settings-tab="appearance"
            className={getSettingsTabClassName(activeTab === "appearance")}
          >
            <Palette className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.appearance}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("memory")}
            data-settings-tab="memory"
            className={getSettingsTabClassName(activeTab === "memory")}
          >
            <Brain className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.memory}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("archived")}
            data-settings-tab="archived"
            className={getSettingsTabClassName(activeTab === "archived")}
          >
            <Archive className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.archived}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("provider")}
            data-settings-tab="provider"
            className={getSettingsTabClassName(activeTab === "provider")}
          >
            <KeyRound className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.provider}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("extensions")}
            data-settings-tab="extensions"
            className={getSettingsTabClassName(activeTab === "extensions")}
          >
            <Puzzle className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.extensions}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("quicklinks")}
            data-settings-tab="quicklinks"
            className={getSettingsTabClassName(activeTab === "quicklinks")}
          >
            <Link2 className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.quicklinks}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shortcuts")}
            data-settings-tab="shortcuts"
            className={getSettingsTabClassName(activeTab === "shortcuts")}
          >
            <Keyboard className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.tabs.shortcuts}
          </button>
        </div>

        <div className="flex min-w-0 flex-1 justify-end [font-size:var(--ow-settings-tab-font)] text-[var(--window-chrome-muted)]">
          {locale === "zh-CN" ? "金果" : "Jingle"}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-[var(--ow-settings-window-pad)]">
        {activeTab === "general" ? (
          <div className={settingsScrollPaneClassName}>
            <GeneralTab locale={locale} />
          </div>
        ) : activeTab === "appearance" ? (
          <div className={settingsScrollPaneClassName}>
            <AppearanceTab locale={locale} />
          </div>
        ) : activeTab === "provider" ? (
          <div className={settingsScrollPaneClassName}>
            <ProviderTab
              focusTarget={focusTarget}
              onFocusTargetConsumed={handleFocusTargetConsumed}
            />
          </div>
        ) : activeTab === "memory" ? (
          <div className={settingsScrollPaneClassName}>
            <MemoryTab locale={locale} />
          </div>
        ) : activeTab === "archived" ? (
          <div className={settingsScrollPaneClassName}>
            <ArchivedThreadsTab locale={locale} />
          </div>
        ) : activeTab === "quicklinks" ? (
          <div className={settingsScrollPaneClassName}>
            <QuicklinksTab locale={locale} />
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
