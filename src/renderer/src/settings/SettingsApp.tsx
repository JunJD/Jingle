import { useCallback, useEffect, useState } from "react"
import { CircleAlert, Settings2 } from "lucide-react"
import {
  createSettingsWindowNavigationPayload,
  type SettingsWindowNavigationPayload,
  type SettingsWindowTab
} from "@shared/settings-window"
import { preloadModelSetupSnapshot } from "@/features/model-provider/model-setup/useModelSetupController"
import { useI18n } from "@/lib/i18n"
import { getSettingsCopy } from "./copy"
import { SETTINGS_PAGE_ORDER, SETTINGS_PAGE_REGISTRY } from "./navigation/registry"

const settingsScrollPaneClassName =
  "h-full overflow-x-hidden overflow-y-auto pr-[var(--jingle-space-1)] [scrollbar-gutter:stable]"

function getSettingsTabClassName(active: boolean, withBorder = true): string {
  return [
    "inline-flex items-center gap-[var(--jingle-gap-sm)] px-[var(--jingle-settings-tab-x)] py-[var(--jingle-settings-tab-y)] [font-size:var(--jingle-settings-tab-font)] font-medium transition",
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
  const [navigation, setNavigation] = useState<SettingsWindowNavigationPayload>(() =>
    createSettingsWindowNavigationPayload("general")
  )
  const [navigationDeliveryFailed, setNavigationDeliveryFailed] = useState(false)

  const navigateToTab = useCallback((tab: SettingsWindowTab) => {
    setNavigation(createSettingsWindowNavigationPayload(tab))
  }, [])

  const handleFocusTargetConsumed = useCallback(() => {
    setNavigation((current) => {
      if (current.tab !== "provider" || !current.target) {
        return current
      }

      return { tab: "provider" }
    })
  }, [])

  useEffect(() => {
    preloadModelSetupSnapshot()

    let disposed = false
    let receivedLiveNavigation = false
    const unsubscribe = window.api.settings.onNavigationChanged((payload) => {
      if (disposed) {
        return
      }

      receivedLiveNavigation = true
      setNavigationDeliveryFailed(false)
      setNavigation(payload)
    })

    void window.api.settings
      .getPendingNavigation()
      .then((payload) => {
        if (disposed || receivedLiveNavigation) {
          return
        }

        setNavigationDeliveryFailed(false)
        if (payload) {
          setNavigation(payload)
        }
      })
      .catch((error: unknown) => {
        if (disposed) {
          return
        }

        console.error("[Settings] Failed to claim pending navigation.", error)
        if (!receivedLiveNavigation) {
          setNavigationDeliveryFailed(true)
        }
      })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const activePage = SETTINGS_PAGE_REGISTRY[navigation.tab]
  const pageContent = activePage.render({
    locale,
    navigation,
    onFocusTargetConsumed: handleFocusTargetConsumed
  })

  return (
    <div className="settings-app flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="settings-window-titlebar app-drag-region flex h-[var(--jingle-settings-toolbar-h)] shrink-0 items-center border-b border-border bg-[var(--window-chrome)] px-[var(--jingle-settings-window-pad)]">
        <div
          className="flex min-w-0 flex-1 items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-settings-tab-font)] font-semibold tracking-[0.05em] text-[var(--window-chrome-foreground)]"
          style={{ paddingLeft: "calc(var(--window-controls-offset-inline) + 6px)" }}
        >
          <Settings2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
          <span>{copy.title}</span>
        </div>

        <div className="app-no-drag inline-flex items-stretch overflow-hidden rounded-[var(--jingle-settings-nav-radius)] border border-border bg-background-elevated">
          {SETTINGS_PAGE_ORDER.map((tab, index) => {
            const definition = SETTINGS_PAGE_REGISTRY[tab]
            const Icon = definition.icon

            return (
              <button
                key={tab}
                type="button"
                aria-current={navigation.tab === tab ? "page" : undefined}
                onClick={() => navigateToTab(tab)}
                data-settings-tab={tab}
                className={getSettingsTabClassName(navigation.tab === tab, index > 0)}
              >
                <Icon className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
                {copy.tabs[tab]}
              </button>
            )
          })}
        </div>

        <div aria-hidden="true" className="min-w-0 flex-1" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-[var(--jingle-settings-window-pad)]">
        {navigationDeliveryFailed ? (
          <div
            role="alert"
            className="mb-[var(--jingle-space-3)] flex shrink-0 items-center gap-[var(--jingle-gap-sm)] border-b border-destructive/30 pb-[var(--jingle-space-3)] text-sm text-destructive"
          >
            <CircleAlert className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)] shrink-0" />
            <span>
              {locale === "zh-CN"
                ? "设置导航初始化失败。请关闭并重新打开设置窗口。"
                : "Settings navigation could not initialize. Close and reopen Settings."}
            </span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {activePage.scrollsWithWindow ? (
            <div className={settingsScrollPaneClassName}>{pageContent}</div>
          ) : (
            pageContent
          )}
        </div>
      </div>
    </div>
  )
}
