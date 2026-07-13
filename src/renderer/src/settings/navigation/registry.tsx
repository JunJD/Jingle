import type { AppLocale } from "@shared/i18n"
import {
  SETTINGS_WINDOW_TABS,
  type SettingsWindowNavigationPayload,
  type SettingsWindowTab
} from "@shared/settings-window"
import {
  Archive,
  Brain,
  Keyboard,
  KeyRound,
  Link2,
  Palette,
  Puzzle,
  Settings2,
  type LucideIcon
} from "lucide-react"
import { AppearanceTab } from "../AppearanceTab"
import { ArchivedThreadsTab } from "../ArchivedThreadsTab"
import { ExtensionsTab } from "../ExtensionsTab"
import { GeneralTab } from "../GeneralTab"
import { MemoryTab } from "../MemoryTab"
import { ProviderTab } from "../ProviderTab"
import { QuicklinksTab } from "../QuicklinksTab"
import { ShortcutsTab } from "../ShortcutsTab"

export const SETTINGS_PAGE_ORDER = SETTINGS_WINDOW_TABS

export interface SettingsPageRenderContext {
  locale: AppLocale
  navigation: SettingsWindowNavigationPayload
  onFocusTargetConsumed: () => void
}

export interface SettingsPageDefinition {
  icon: LucideIcon
  render: (context: SettingsPageRenderContext) => React.JSX.Element
  scrollsWithWindow: boolean
}

export const SETTINGS_PAGE_REGISTRY = {
  general: {
    icon: Settings2,
    render: ({ locale }) => <GeneralTab locale={locale} />,
    scrollsWithWindow: true
  },
  appearance: {
    icon: Palette,
    render: ({ locale }) => <AppearanceTab locale={locale} />,
    scrollsWithWindow: true
  },
  memory: {
    icon: Brain,
    render: ({ locale }) => <MemoryTab locale={locale} />,
    scrollsWithWindow: true
  },
  archived: {
    icon: Archive,
    render: ({ locale }) => <ArchivedThreadsTab locale={locale} />,
    scrollsWithWindow: true
  },
  provider: {
    icon: KeyRound,
    render: ({ navigation, onFocusTargetConsumed }) => {
      if (navigation.tab !== "provider") {
        throw new Error(`Settings page registry mismatch: expected provider, got ${navigation.tab}`)
      }

      return (
        <ProviderTab
          focusTarget={navigation.target ?? null}
          onFocusTargetConsumed={onFocusTargetConsumed}
        />
      )
    },
    scrollsWithWindow: true
  },
  extensions: {
    icon: Puzzle,
    render: ({ locale, navigation }) => {
      if (navigation.tab !== "extensions") {
        throw new Error(
          `Settings page registry mismatch: expected extensions, got ${navigation.tab}`
        )
      }

      return <ExtensionsTab focusTarget={navigation.target ?? null} locale={locale} />
    },
    scrollsWithWindow: false
  },
  quicklinks: {
    icon: Link2,
    render: ({ locale }) => <QuicklinksTab locale={locale} />,
    scrollsWithWindow: true
  },
  shortcuts: {
    icon: Keyboard,
    render: ({ locale }) => <ShortcutsTab locale={locale} />,
    scrollsWithWindow: true
  }
} satisfies Record<SettingsWindowTab, SettingsPageDefinition>
