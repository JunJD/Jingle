export type SettingsWindowTab = "general" | "extensions"

export interface SettingsWindowTarget {
  commandName?: string
  extensionName?: string
}

export interface SettingsWindowNavigationPayload {
  tab: SettingsWindowTab
  target?: SettingsWindowTarget
}
