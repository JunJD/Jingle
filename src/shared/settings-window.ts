export type SettingsWindowTab = "general" | "extensions" | "shortcuts"

export interface SettingsWindowTarget {
  commandName?: string
  extensionName?: string
}

export interface SettingsWindowNavigationPayload {
  tab: SettingsWindowTab
  target?: SettingsWindowTarget
}
